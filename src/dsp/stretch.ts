/**
 * Tonu değiştirmeden hız, hızı değiştirmeden ton: WSOLA zaman esnetme + yeniden örnekleme.
 *
 * İki aşama:
 *  1. WSOLA (waveform-similarity overlap-add): giriş, örtüşen pencerelerle okunur; her pencerenin yeri, bir
 *     önceki pencerenin doğal devamına en çok benzeyen noktaya kaydırılır (dalga biçimi sürekliliği korunur).
 *     Bu aşama süreyi `ratio / speed` katına çıkarır, perdeyi değiştirmez.
 *  2. Ara sinyal `ratio` oranında yeniden örneklenir: perde `ratio` katına çıkar, süre `1 / ratio` olur.
 * Net sonuç: çalma hızı `speed`, perde `ratio`.
 *
 * Vuruş koruma: düz WSOLA yavaşlatırken vuruşları (pena atağı, davul) birkaç pencereye yayıp çiftler. Bunu
 * önlemek için girişteki ani enerji artışları önceden bulunur; her vuruşun çevresi özgün hızda (pencereler doğal
 * ardışıklıkta) geçilir ve o bölgeye bir daha dönülmez. Esnetme, vuruşlar arasındaki durağan bölümlere kayar.
 *
 * Gerçek zamanlı kullanım için akış biçimindedir (`process` istenen kadar örnek üretir); AudioWorklet içinde
 * ve testlerde aynı sınıf çalışır.
 */

export interface StretchOptions {
  /** Pencere uzunluğu (örnek, 2'nin kuvveti). Varsayılan ~40 ms. */
  frame?: number;
  /** Benzerlik araması: nominal konumun ± kaç örnek çevresi. Varsayılan ~12 ms. */
  search?: number;
  /** Vuruş konumları (giriş örneği, artan). Verilmezse girişten bulunur; boş dizi vuruş korumayı kapatır. */
  transients?: ArrayLike<number>;
}

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 2;
export const MAX_SEMITONES = 12;

export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

function pow2AtLeast(n: number): number {
  let p = 256;
  while (p < n) p *= 2;
  return p;
}

/**
 * Girişteki vuruşları (ani enerji artışı) bulur.
 * @param minGap Ardışık iki vuruş arasındaki en kısa süre (örnek).
 * @returns Vuruşların başladığı örnek konumları, artan sırada.
 */
export function findTransients(x: ArrayLike<number>, sampleRate: number, minGap: number = Math.round(0.06 * sampleRate)): number[] {
  const hop = Math.max(16, Math.round(0.004 * sampleRate));
  const count = Math.floor(x.length / hop);
  if (count < 8) return [];
  const energy = new Float32Array(count);
  let total = 0;
  for (let k = 0; k < count; k++) {
    let e = 0;
    const from = k * hop;
    for (let i = 0; i < hop; i++) e += x[from + i] * x[from + i];
    energy[k] = e / hop;
    total += energy[k];
  }
  // Mutlak eşik: çok kısık bölümlerdeki dalgalanmalar vuruş sayılmaz.
  const floor = Math.max(1e-7, (total / count) * 0.02);
  // Önceki ~60 ms'nin ortalamasıyla karşılaştırılır: iki notanın vuruşması (beating) gibi hızlı genlik
  // dalgalanmaları bu pencerede ortalanır ve vuruş sanılmaz. Araya bir dilim boşluk bırakılır.
  const history = Math.max(4, Math.round((0.06 * sampleRate) / hop));
  const out: number[] = [];
  let last = -Infinity;
  for (let k = 2; k < count - 1; k++) {
    let before = 0;
    let n = 0;
    for (let j = Math.max(0, k - 1 - history); j < k - 1; j++) {
      before += energy[j];
      n++;
    }
    before /= n;
    // İki dilimlik ortalama: atağın dilim sınırına denk gelmesi sonucu değiştirmesin.
    const now = 0.5 * (energy[k] + energy[k + 1]);
    if (now > floor && now > 3 * before + floor && k * hop - last >= minGap) {
      out.push(k * hop);
      last = k * hop;
    }
  }
  return out;
}

export class TimeStretcher {
  readonly sampleRate: number;
  readonly frame: number;
  private readonly hop: number;
  private readonly search: number;
  private readonly window: Float32Array;
  private readonly ola: Float32Array;
  private readonly input: Float32Array;
  private readonly transients: ArrayLike<number>;
  /** Vuruştan önce / sonra korunan süre (örnek). */
  private readonly pre: number;
  private readonly post: number;
  /** Vuruş koruması yüzünden çalmanın istenen konumun en çok ne kadar önüne geçebileceği (örnek). */
  private readonly maxLead: number;

  private speed = 1;
  private ratio = 1;
  /** Sıradaki pencerenin nominal başlangıcı (giriş örneği, kesirli). */
  private nominal = 0;
  /** Bir önceki pencerenin gerçek başlangıcı; yoksa (başlangıç, konum atlaması) null. */
  private prev: number | null = null;
  /** Özgün hızda geçilmekte olan vuruşun konumu; yoksa -1. */
  private chain = -1;
  /** Pencerelerin başlayabileceği en erken konum (geçilmiş bir vuruşa geri dönülmesin diye). */
  private floor = -Infinity;
  /** Giriş bittikten sonra üretilen pencere sayısı. */
  private tail = 0;

  /** Ara sinyal (1. aşamanın çıktısı), okuma konumu ve gerçek sesin bittiği yer. */
  private inter: Float32Array;
  private have = 0;
  private read = 1;
  private endMark = -1;
  /** Döngü başına dönüldüğünde ara sinyalde yeni turun başladığı yer; hiç dönülmediyse -1. */
  private wrapMark = -1;

  private loopA: number | null = null;
  private loopB: number | null = null;

  constructor(input: Float32Array, sampleRate: number, opts: StretchOptions = {}) {
    this.input = input;
    this.sampleRate = sampleRate;
    this.frame = opts.frame ?? pow2AtLeast(0.04 * sampleRate);
    this.hop = this.frame / 2;
    this.search = opts.search ?? Math.round(0.012 * sampleRate);
    this.pre = Math.round(0.008 * sampleRate);
    this.post = Math.round(0.02 * sampleRate);
    this.maxLead = Math.round(0.12 * sampleRate);
    this.transients =
      opts.transients ?? findTransients(input, sampleRate, this.pre + this.post + this.hop + Math.round(0.005 * sampleRate));
    // Periyodik Hann: %50 örtüşmede pencerelerin toplamı tam 1'dir.
    this.window = new Float32Array(this.frame);
    for (let i = 0; i < this.frame; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frame);
    this.ola = new Float32Array(this.frame);
    this.inter = new Float32Array(this.frame * 4);
    this.reset();
  }

  get length(): number {
    return this.input.length;
  }

  /** Çalma hızı (1 = özgün). */
  setSpeed(speed: number): void {
    this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
  }

  /** Ton kaydırma (yarım ton; + tiz, − pes). */
  setSemitones(semitones: number): void {
    this.ratio = semitonesToRatio(Math.min(MAX_SEMITONES, Math.max(-MAX_SEMITONES, semitones)));
  }

  /** A–B döngüsü (giriş örneği). Geçersiz ya da null ise döngü kapalı. */
  setLoop(a: number | null, b: number | null): void {
    if (a === null || b === null || b - a < this.frame) {
      this.loopA = null;
      this.loopB = null;
      this.wrapMark = -1;
      return;
    }
    this.loopA = Math.max(0, Math.round(a));
    this.loopB = Math.min(this.input.length, Math.round(b));
  }

  /** Çalma konumunu değiştirir (giriş örneği). */
  seek(position: number): void {
    this.nominal = Math.max(0, Math.min(this.input.length, position));
    this.reset();
  }

  private reset(): void {
    this.prev = null;
    this.chain = -1;
    this.floor = -Infinity;
    this.tail = 0;
    this.endMark = -1;
    this.wrapMark = -1;
    this.ola.fill(0);
    this.inter.fill(0);
    // Ara sinyalin başında enterpolasyon için bir örneklik boşluk bırakılır.
    this.have = 1;
    this.read = 1;
  }

  /** Şu an duyulan sesin girişteki yaklaşık konumu (örnek). */
  get position(): number {
    const a = this.speed / this.ratio;
    const unread = this.have - this.read;
    const p = this.nominal + this.hop * (1 - a) - unread * a;
    if (this.loopA !== null && this.loopB !== null && this.wrapMark >= 0) {
      // Döngü başına yeni dönüldüyse duyulan ses hâlâ önceki turun sonudur.
      if (this.read < this.wrapMark) return Math.max(this.loopA, this.loopB - (this.wrapMark - this.read) * a);
      return Math.max(this.loopA, Math.min(this.loopB, p));
    }
    return Math.max(0, Math.min(this.input.length, p));
  }

  /** Giriş bitti ve üretilen sesin tamamı okundu. */
  get ended(): boolean {
    return this.endMark >= 0 && this.read >= this.endMark;
  }

  /** `value`dan küçük olmayan ilk vuruş; yoksa Infinity. */
  private transientFrom(value: number): number {
    const t = this.transients;
    let lo = 0;
    let hi = t.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] < value) lo = mid + 1;
      else hi = mid;
    }
    return lo < t.length ? t[lo] : Infinity;
  }

  /**
   * `target`teki parçaya (bir önceki pencerenin doğal devamı) en çok benzeyen parçanın başlangıcını `[lo, hi]`
   * içinde arar. Hız için önce seyrek tarar, sonra en iyinin çevresini inceltir.
   */
  private bestStart(target: number, lo: number, hi: number, fallback: number): number {
    const x = this.input;
    const len = this.hop;
    lo = Math.max(0, Math.ceil(lo));
    hi = Math.min(x.length - len, Math.floor(hi));
    if (hi < lo) return Math.max(0, Math.min(x.length, Math.round(fallback)));
    if (hi === lo || target < 0 || target + len > x.length) return Math.max(lo, Math.min(hi, Math.round(fallback)));

    const score = (start: number, stride: number): number => {
      let dot = 0;
      let energy = 1e-9;
      for (let i = 0; i < len; i += stride) {
        const y = x[start + i];
        dot += x[target + i] * y;
        energy += y * y;
      }
      return dot / Math.sqrt(energy);
    };

    let best = lo;
    let bestScore = -Infinity;
    for (let s = lo; s <= hi; s += 2) {
      const v = score(s, 4);
      if (v > bestScore) {
        bestScore = v;
        best = s;
      }
    }
    let fine = best;
    let fineScore = -Infinity;
    for (let s = Math.max(lo, best - 2); s <= Math.min(hi, best + 2); s++) {
      const v = score(s, 2);
      if (v > fineScore) {
        fineScore = v;
        fine = s;
      }
    }
    return fine;
  }

  /** Sıradaki pencerenin girişteki başlangıcını seçer. */
  private choose(a: number): number {
    const { hop, frame, search, pre, post } = this;
    const wanted = Math.round(this.nominal);
    const next = this.prev === null ? null : this.prev + hop;

    // Hız 1: pencereler doğal ardışıklıkta, sinyal aynen geçer.
    if (Math.abs(a - 1) <= 1e-3) {
      this.chain = -1;
      this.floor = -Infinity;
      return next ?? wanted;
    }
    // Bir vuruş özgün hızda geçiliyor: bölge bitene kadar doğal ardışıklık.
    if (this.chain >= 0 && next !== null) {
      if (next < this.chain + post) return next;
      this.floor = this.chain + post;
      this.chain = -1;
    }

    const center = Math.max(wanted, this.floor);
    // Hâlâ temiz geçilebilecek ilk vuruş: zincir en geç `t - pre - hop`ta başlamalı.
    const earliest = Math.max(this.floor, this.prev ?? -Infinity);
    const t = this.transientFrom(earliest + pre + hop);
    const limit = t - pre - hop;
    const untouched = t - pre - frame;
    if (center > untouched) {
      // Zincirin başlangıcı, nominal konumun vuruşa uzaklığına göre seçilir: böylece her vuruş istenen yerine
      // göre aynı miktarda kayar (pencere adımından bağımsız) ve vuruşlar arası süreler korunur.
      const start = Math.min(limit, Math.max(this.floor, untouched + (wanted - untouched) / a));
      if (start - wanted <= this.maxLead) {
        this.chain = t;
        if (next === null) return Math.round(start);
        return this.bestStart(next, Math.max(this.floor, start - search), start, start);
      }
      // Vuruşlar çok sık: korumak çalmayı istenen hızın fazla önüne geçirirdi; bu vuruş korunmaz.
      if (next === null) return center;
      return this.bestStart(next, Math.max(this.floor, center - search), center + search, center);
    }
    if (next === null) return center;
    return this.bestStart(next, Math.max(this.floor, center - search), Math.min(center + search, untouched), center);
  }

  /** 1. aşama: bir pencere daha işler ve ara sinyale `hop` örnek ekler. */
  private produce(): void {
    const { input, frame, hop, ola, window } = this;
    const a = this.speed / this.ratio;
    if (this.loopA !== null && this.loopB !== null && Math.round(this.nominal) >= this.loopB) {
      // Döngü başına dön: önceki pencerenin kuyruğu yeni pencereyle kendiliğinden çapraz geçiş yapar.
      this.nominal = this.loopA;
      this.wrapMark = this.have;
      this.prev = null;
      this.chain = -1;
      this.floor = -Infinity;
    }
    const pos = Math.round(this.nominal) < input.length ? this.choose(a) : input.length;
    if (pos >= input.length) {
      this.tail++;
      this.nominal += hop * a;
    } else {
      const n = Math.min(frame, input.length - pos);
      for (let i = 0; i < n; i++) ola[i] += window[i] * input[pos + i];
      this.prev = pos;
      // Hız 1'de nominal konum gerçek konumu izler (birikimli yuvarlama kayması olmasın).
      this.nominal = Math.abs(a - 1) <= 1e-3 ? pos + hop : this.nominal + hop * a;
    }

    if (this.have + hop > this.inter.length) this.compact(hop);
    this.inter.set(ola.subarray(0, hop), this.have);
    this.have += hop;
    ola.copyWithin(0, hop);
    ola.fill(0, frame - hop);
    if (this.tail === 1 && this.endMark < 0) this.endMark = this.have;
  }

  /** Okunmuş ara örnekleri atar; gerekirse arabelleği büyütür. */
  private compact(need: number): void {
    const keepFrom = Math.max(0, Math.floor(this.read) - 1);
    if (keepFrom > 0) {
      this.inter.copyWithin(0, keepFrom, this.have);
      this.have -= keepFrom;
      this.read -= keepFrom;
      if (this.endMark >= 0) this.endMark -= keepFrom;
      if (this.wrapMark >= 0) this.wrapMark = Math.max(0, this.wrapMark - keepFrom);
    }
    if (this.have + need > this.inter.length) {
      const bigger = new Float32Array(Math.max(this.inter.length * 2, this.have + need));
      bigger.set(this.inter.subarray(0, this.have));
      this.inter = bigger;
    }
  }

  /** `out`u doldurur (2. aşama: ara sinyali `ratio` oranında kübik enterpolasyonla okur). */
  process(out: Float32Array): void {
    const r = this.ratio;
    for (let n = 0; n < out.length; n++) {
      // `produce` arabelleği kaydırabilir: okuma konumu her seferinde yeniden hesaplanır.
      while (this.have < Math.floor(this.read) + 3) this.produce();
      const j = Math.floor(this.read);
      const t = this.read - j;
      const b = this.inter;
      if (t === 0) {
        out[n] = b[j];
      } else {
        // Catmull-Rom (kübik Hermite) enterpolasyon.
        const y0 = b[j - 1];
        const y1 = b[j];
        const y2 = b[j + 1];
        const y3 = b[j + 2];
        const c1 = 0.5 * (y2 - y0);
        const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
        const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        out[n] = ((c3 * t + c2) * t + c1) * t + y1;
      }
      this.read += r;
    }
  }
}

/** Tüm girişi verilen hız ve tonla çevrimdışı işler (testler ve ölçüm için). */
export function stretchAll(input: Float32Array, sampleRate: number, speed: number, semitones = 0, opts: StretchOptions = {}): Float32Array {
  const st = new TimeStretcher(input, sampleRate, opts);
  st.setSpeed(speed);
  st.setSemitones(semitones);
  const total = Math.ceil(input.length / speed);
  const out = new Float32Array(total);
  const block = new Float32Array(128);
  for (let done = 0; done < total; done += block.length) {
    st.process(block);
    out.set(done + block.length <= total ? block : block.subarray(0, total - done), done);
  }
  return out;
}
