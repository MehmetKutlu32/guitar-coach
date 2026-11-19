/**
 * Canlı efektlerin saf hesapları (Aşama 16): distortion eğrisi, ton/seviye eşlemeleri, delay süresi,
 * reverb dürtü yanıtı (impulse response), noise gate ve geri besleme (ıslık) koruması.
 * Web Audio düğümleri `src/features/fx/chain.ts`'te kurulur; burada yalnızca sayı hesabı vardır (Vitest ile sınanır).
 */
import { FFT, hann } from './fft';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
}

/**
 * Yüzdelik ses düğmesi → doğrusal kazanç. 0 = sessiz, 100 = `maxDb`; arada 40 dB'lik logaritmik aralık
 * (kulak seviyeyi logaritmik duyar: düğmenin ortası "yarı yüksek" gelir).
 */
export function faderGain(percent: number, maxDb = 0): number {
  const p = clamp(percent, 0, 100);
  if (p <= 0) return 0;
  return dbToGain(maxDb - 40 * (1 - p / 100));
}

// ---------- Distortion / overdrive ----------

/** WaveShaper eğrisinin nokta sayısı. */
export const CURVE_SIZE = 4097;

/** Drive düğmesi (0..100) → eğrinin ön kazancı k. 0 → doğrusal (k = 0), 100 → ~59 (yoğun kırpma). */
export function driveAmount(drive: number): number {
  const d = clamp(drive, 0, 100) / 100;
  return 0.6 * (Math.pow(100, d) - 1);
}

/**
 * Yumuşak kırpma eğrisi: y = tanh(k·x) / tanh(k). Tek simetrili (tek harmonikler), tekdüze artan,
 * |y| ≤ 1 (WaveShaper [-1, 1] dışındaki girişi uç değere sabitler; çıkış hiçbir zaman 1'i aşmaz).
 * k = 0 iken eğri doğrusaldır.
 */
export function driveCurve(drive: number, size = CURVE_SIZE): Float32Array {
  const k = driveAmount(drive);
  const curve = new Float32Array(size);
  const norm = k > 0 ? Math.tanh(k) : 1;
  for (let i = 0; i < size; i++) {
    const x = (i * 2) / (size - 1) - 1;
    curve[i] = k > 0 ? Math.tanh(k * x) / norm : x;
  }
  return curve;
}

/**
 * Seviye dengeleme: küçük sinyalde eğrinin kazancı k / tanh(k) olur (yoğun drive'da +35 dB'e kadar).
 * Bunun kareköküyle bölünür; böylece drive artınca ses patlamaz ama kırpılmış sesin doluluğu duyulur.
 */
export function driveMakeup(drive: number): number {
  const k = driveAmount(drive);
  if (k <= 0) return 1;
  return 1 / Math.sqrt(k / Math.tanh(k));
}

/** Ton düğmesi (0..100) → kırpmadan sonraki alçak geçiren süzgecin kesim frekansı (700 Hz … 11,2 kHz). */
export function toneHz(tone: number): number {
  return 700 * Math.pow(16, clamp(tone, 0, 100) / 100);
}

/** Overdrive çıkış seviyesi: düğmenin 100'ü +6 dB. */
export function driveLevelGain(level: number, drive: number): number {
  return faderGain(level, 6) * driveMakeup(drive);
}

/**
 * Zincirin sonundaki güvenlik kırpıcısı: |x| ≤ `knee` arası birebir, üstü tanh ile yumuşakça 1'e yaklaşır.
 * Eğri [-1, 1] aralığında `range` katına ölçeklenmiş girişi karşılar (giriş önce 1/range ile çarpılır);
 * böylece +12 dB'e kadar aşırı sinyal de kırpılmadan bastırılır. Gecikme eklemez (aşırı örnekleme yok).
 */
export function safetyCurve(range = 4, knee = 0.8, size = CURVE_SIZE): Float32Array {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = ((i * 2) / (size - 1) - 1) * range;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/** Bir eğriyi WaveShaper gibi uygular (doğrusal ara değer, [-1, 1] dışı uca sabitlenir). */
export function applyCurve(curve: Float32Array, x: number): number {
  const n = curve.length;
  const pos = ((clamp(x, -1, 1) + 1) / 2) * (n - 1);
  const i = Math.floor(pos);
  if (i >= n - 1) return curve[n - 1];
  const f = pos - i;
  return curve[i] * (1 - f) + curve[i + 1] * f;
}

// ---------- Delay ----------

export const DELAY_DIVISIONS = ['1/4', '1/8.', '1/8', '1/8t', '1/16'] as const;
export type DelayDivision = (typeof DELAY_DIVISIONS)[number];

/** Nota değerinin vuruş cinsinden uzunluğu. */
export const DIVISION_BEATS: Record<DelayDivision, number> = {
  '1/4': 1,
  '1/8.': 0.75,
  '1/8': 0.5,
  '1/8t': 1 / 3,
  '1/16': 0.25,
};

export const MIN_DELAY_MS = 20;
export const MAX_DELAY_MS = 1500;
/** Geri beslemenin üst sınırı: 1'e yaklaşınca yankılar sönmez, birikip kırpılır. */
export const MAX_FEEDBACK = 0.9;

/** Delay süresi (saniye). Tempo senkronunda metronom temposundan hesaplanır. */
export function delaySeconds(p: { timeMs: number; sync: boolean; division: DelayDivision }, bpm: number): number {
  const ms = p.sync ? (60000 / clamp(bpm, 20, 400)) * (DIVISION_BEATS[p.division] ?? 0.5) : p.timeMs;
  return clamp(ms, MIN_DELAY_MS, MAX_DELAY_MS) / 1000;
}

export function feedbackGain(percent: number): number {
  return Math.min(MAX_FEEDBACK, clamp(percent, 0, 100) / 100);
}

/** Islak (efektli) sinyalin kazancı; kuru sinyal hep 1 kalır (pedal gibi: çalınan ses kısılmaz). */
export function wetGain(mix: number): number {
  return clamp(mix, 0, 100) / 100;
}

/** n. yankının (n ≥ 1) göreli genliği (geri besleme yolundaki koyulaştırma süzgeci hariç). */
export function echoLevel(n: number, mix: number, feedback: number): number {
  return wetGain(mix) * Math.pow(feedbackGain(feedback), n - 1);
}

/** Geri besleme yolundaki tek kutuplu alçak geçiren süzgecin kesimi: her tekrar biraz daha koyu (bant yankısı gibi). */
export const DELAY_DAMP_HZ = 4500;

/**
 * Geri beslemeli delay (tek kanal, akış biçiminde; worklet ve testlerde aynı sınıf).
 * çıkış = giriş + mix · gecikmiş; gecikme hattına giriş + feedback · koyulaştırılmış(gecikmiş) yazılır.
 * Web Audio'da DelayNode bir döngü içindeyse tarayıcı her turda bir işleme bloğu (128 örnek) ekler; bu yüzden
 * geri besleme burada, örnek hassasiyetinde yapılır. Süre değişince okuma noktası yumuşakça kayar (tıkırtı yerine
 * bantlı delay'lerdeki gibi kısa bir perde kayması duyulur).
 */
export class FeedbackDelay {
  private readonly buffer: Float32Array;
  private write = 0;
  private time = -1;
  private target = 0;
  private feedback = 0;
  private mix = 0;
  private lp = 0;
  private readonly dampCoef: number;
  private readonly glide: number;

  constructor(readonly sampleRate: number, maxSeconds = MAX_DELAY_MS / 1000) {
    this.buffer = new Float32Array(Math.ceil(maxSeconds * sampleRate) + 4);
    this.dampCoef = 1 - Math.exp((-2 * Math.PI * DELAY_DAMP_HZ) / sampleRate);
    this.glide = 1 - Math.exp(-1 / (0.05 * sampleRate));
  }

  /** @param seconds gecikme · @param feedback 0..0,9 · @param mix ıslak sinyal kazancı */
  set(seconds: number, feedback: number, mix: number): void {
    const max = this.buffer.length - 3;
    this.target = clamp(seconds * this.sampleRate, 1, max);
    if (this.time < 0) this.time = this.target;
    this.feedback = clamp(feedback, 0, MAX_FEEDBACK);
    this.mix = Math.max(0, mix);
  }

  /** `output` `input` ile aynı dizi olabilir. */
  process(input: ArrayLike<number>, output: Float32Array): void {
    const buf = this.buffer;
    const size = buf.length;
    if (this.time < 0) this.time = this.target;
    for (let i = 0; i < input.length; i++) {
      if (this.time !== this.target) {
        // Üstel yaklaşım, ama okuma hızı en fazla ±%50 değişir (perde kayması sınırlı kalsın).
        this.time += clamp((this.target - this.time) * this.glide, -0.5, 0.5);
        if (Math.abs(this.target - this.time) < 1e-4) this.time = this.target;
      }
      let pos = this.write - this.time;
      if (pos < 0) pos += size;
      const j = Math.floor(pos);
      const f = pos - j;
      const a = buf[j];
      const b = buf[j + 1 === size ? 0 : j + 1];
      const delayed = f === 0 ? a : a + (b - a) * f;
      this.lp += (delayed - this.lp) * this.dampCoef;
      const x = input[i];
      buf[this.write] = x + this.feedback * this.lp;
      output[i] = x + this.mix * delayed;
      this.write = this.write + 1 === size ? 0 : this.write + 1;
    }
  }
}

// ---------- Reverb ----------

export const MIN_DECAY = 0.3;
export const MAX_DECAY = 6;

/** Oda boyutu (0..100) → ön gecikme (ilk yansımadan önceki boşluk), saniye. 4 … 34 ms. */
export function reverbPreDelay(size: number): number {
  return 0.004 + 0.03 * (clamp(size, 0, 100) / 100);
}

/** Oda boyutu → kuyruğun dolma süresi (saniye): büyük salonlarda yankı yavaş yoğunlaşır. 2 … 40 ms. */
export function reverbBuildUp(size: number): number {
  return 0.002 + 0.038 * (clamp(size, 0, 100) / 100);
}

/** Tekrarlanabilir sözde rastgele sayı üreteci (aynı tohum → aynı dürtü yanıtı). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** T60 sönümü: t saniyede genlik zarfı (t = decay → −60 dB). */
export function reverbEnvelope(t: number, decay: number): number {
  return Math.pow(10, (-3 * t) / decay);
}

/**
 * Dürtü yanıtı: kanal başına ayrı (ilintisiz → stereo genişlik) gürültü; zamanla koyulaşan (yüksek frekansları
 * önce sönen) bir süzgeçten geçer, sonra bloklar halinde tam olarak T60 zarfına oturtulur. Böylece sönüm süresi
 * süzgeçten bağımsız olarak `decay` saniyede −60 dB'dir. Her kanalın toplam enerjisi `energy`'ye ölçeklenir.
 */
export function reverbImpulse(
  sampleRate: number,
  decay: number,
  size: number,
  channels = 2,
  seed = 1,
  energy = 0.5,
): Float32Array[] {
  const T = clamp(decay, MIN_DECAY, MAX_DECAY);
  const pre = Math.round(reverbPreDelay(size) * sampleRate);
  const build = reverbBuildUp(size);
  const tail = Math.ceil(T * 1.15 * sampleRate);
  const length = pre + tail;
  const block = 128;
  const out: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    const rnd = mulberry32(seed * 7919 + ch * 104729 + 1);
    const h = new Float32Array(length);
    let y = 0;
    for (let i = 0; i < tail; i++) {
      const t = i / sampleRate;
      // Kesim frekansı 9 kHz'ten başlar, T anında ~1,8 kHz'e iner.
      const fc = 9000 * Math.pow(0.2, t / T);
      const a = Math.exp((-2 * Math.PI * fc) / sampleRate);
      y = (1 - a) * (rnd() * 2 - 1) + a * y;
      h[pre + i] = y;
    }
    // Blok RMS'ini hedef zarfa oturt; bloklar arasında ölçek doğrusal geçer (basamak olmasın).
    const blocks = Math.ceil(tail / block);
    const scale = new Float64Array(blocks);
    for (let b = 0; b < blocks; b++) {
      const from = pre + b * block;
      const to = Math.min(length, from + block);
      let sum = 0;
      for (let i = from; i < to; i++) sum += h[i] * h[i];
      const rms = Math.sqrt(sum / Math.max(1, to - from)) || 1e-12;
      const tMid = (b * block + (to - from) / 2) / sampleRate;
      const attack = Math.min(1, tMid / build);
      scale[b] = (reverbEnvelope(tMid, T) * attack) / rms;
    }
    for (let i = 0; i < tail; i++) {
      const pos = i / block - 0.5;
      const b0 = clamp(Math.floor(pos), 0, blocks - 1);
      const b1 = Math.min(blocks - 1, b0 + 1);
      const f = clamp(pos - b0, 0, 1);
      h[pre + i] *= scale[b0] * (1 - f) + scale[b1] * f;
    }
    let total = 0;
    for (let i = 0; i < length; i++) total += h[i] * h[i];
    const norm = Math.sqrt(energy / (total || 1));
    for (let i = 0; i < length; i++) h[i] *= norm;
    out.push(h);
  }
  return out;
}

/** Ardışık bloklarda RMS (dB) dizisi: sönüm ölçümü için. */
export function blockRmsDb(samples: ArrayLike<number>, sampleRate: number, blockSeconds = 0.01): number[] {
  const n = Math.max(1, Math.round(blockSeconds * sampleRate));
  const out: number[] = [];
  for (let from = 0; from + n <= samples.length; from += n) {
    let sum = 0;
    for (let i = from; i < from + n; i++) sum += samples[i] * samples[i];
    out.push(10 * Math.log10(sum / n + 1e-30));
  }
  return out;
}

// ---------- Noise gate ----------

export interface GateOptions {
  /** Açılma eşiği (dBFS). Kapanma eşiği bunun 6 dB altıdır (histerezis: eşik çevresinde titremesin). */
  thresholdDb: number;
  attack?: number;
  hold?: number;
  release?: number;
}

/**
 * Basit gürültü kapısı: tepe zarfı eşiğin üstüne çıkınca 1 ms'de açılır; zarf kapanma eşiğinin altına inip
 * `hold` süresi geçince `release` süresinde kapanır. Akış biçiminde (worklet ve testlerde aynı sınıf).
 */
export class NoiseGate {
  private env = 0;
  private gain = 0;
  private holdLeft = 0;
  private open = false;
  private openLevel = 0;
  private closeLevel = 0;
  private readonly envRelease: number;
  private readonly attackStep: number;
  private readonly releaseStep: number;
  private readonly holdSamples: number;

  constructor(readonly sampleRate: number, opts: GateOptions) {
    this.envRelease = Math.exp(-1 / (0.02 * sampleRate));
    this.attackStep = 1 / ((opts.attack ?? 0.001) * sampleRate);
    this.releaseStep = 1 / ((opts.release ?? 0.08) * sampleRate);
    this.holdSamples = Math.round((opts.hold ?? 0.05) * sampleRate);
    this.setThreshold(opts.thresholdDb);
  }

  setThreshold(db: number): void {
    this.openLevel = dbToGain(db);
    this.closeLevel = dbToGain(db - 6);
  }

  get isOpen(): boolean {
    return this.open;
  }

  get currentGain(): number {
    return this.gain;
  }

  /** `output` `input` ile aynı dizi olabilir. */
  process(input: Float32Array, output: Float32Array): void {
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const a = Math.abs(x);
      this.env = a > this.env ? a : this.env * this.envRelease;
      if (this.env >= this.openLevel) {
        this.open = true;
        this.holdLeft = this.holdSamples;
      } else if (this.open && this.env < this.closeLevel) {
        if (this.holdLeft > 0) this.holdLeft--;
        else this.open = false;
      }
      if (this.open) this.gain = Math.min(1, this.gain + this.attackStep);
      else this.gain = Math.max(0, this.gain - this.releaseStep);
      output[i] = x * this.gain;
    }
  }
}

// ---------- Geri besleme (ıslık) koruması ----------

export type GuardVerdict = 'ok' | 'clip' | 'howl';

export interface GuardFrame {
  rms: number;
  peak: number;
  /** En güçlü spektrum tepesi çevresindeki enerjinin toplam enerjiye oranı (0..1): saf tonda ~1. */
  tonality: number;
  /** En güçlü tepenin frekansı (Hz). */
  freq: number;
}

export const CLIP_LEVEL = 0.99;

/** Bir analiz çerçevesinin seviyesi ve "tek ton" oranı. Çerçeve uzunluğu 2'nin kuvveti olmalı. */
export function analyzeGuardFrame(samples: Float32Array, sampleRate: number, fft?: FFT): GuardFrame {
  const n = samples.length;
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i];
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / n);
  if (rms < 1e-4) return { rms, peak, tonality: 0, freq: 0 };
  const f = fft && fft.size === n ? fft : new FFT(n);
  const w = hann(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = samples[i] * w[i];
  f.forward(re, im);
  const half = n / 2;
  const power = new Float64Array(half);
  let total = 0;
  let best = 2;
  for (let k = 2; k < half; k++) {
    power[k] = re[k] * re[k] + im[k] * im[k];
    total += power[k];
    if (power[k] > power[best]) best = k;
  }
  let near = 0;
  for (let k = Math.max(2, best - 3); k <= Math.min(half - 1, best + 3); k++) near += power[k];
  return { rms, peak, tonality: total > 0 ? near / total : 0, freq: (best * sampleRate) / n };
}

export interface GuardOptions {
  /** Kesintisiz kırpılma bu süreyi aşınca: 'clip'. */
  clipSeconds?: number;
  /** Yükselen tek ton bu süre boyunca izlenir. */
  riseSeconds?: number;
  /** Bu pencerede en az bu kadar yükselmeli (dB). */
  riseDb?: number;
  /** Sabit, yüksek, saf ton bu süreyi aşınca da: 'howl' (doymuş geri besleme). */
  steadySeconds?: number;
}

/**
 * Hoparlör → mikrofon geri beslemesini ve sürekli kırpılmayı yakalar. Çerçeveler (~50 ms arayla) sırayla verilir.
 *  - clip: sinyal `clipSeconds` boyunca kesintisiz tam ölçekte.
 *  - howl: tek bir frekansta saf bir ton `riseSeconds` içinde `riseDb` kadar ve sürekli yükseliyor
 *    (geri besleme üstel büyür; gitar notası ise atakla başlar ve söner), ya da yüksek ve saf bir ton
 *    `steadySeconds` boyunca hiç sönmeden sürüyor (sınırlayıcıya dayanmış geri besleme).
 */
export class HowlGuard {
  private clipRun = 0;
  private history: { t: number; frame: GuardFrame }[] = [];
  private time = 0;
  private readonly clipSeconds: number;
  private readonly riseSeconds: number;
  private readonly riseDb: number;
  private readonly steadySeconds: number;

  constructor(opts: GuardOptions = {}) {
    this.clipSeconds = opts.clipSeconds ?? 0.5;
    this.riseSeconds = opts.riseSeconds ?? 0.8;
    this.riseDb = opts.riseDb ?? 9;
    this.steadySeconds = opts.steadySeconds ?? 4;
  }

  reset(): void {
    this.clipRun = 0;
    this.history = [];
    this.time = 0;
  }

  /** @param dt Bir önceki çerçeveden bu yana geçen süre (saniye). */
  push(frame: GuardFrame, dt: number): GuardVerdict {
    this.time += dt;
    this.clipRun = frame.peak >= CLIP_LEVEL ? this.clipRun + dt : 0;
    if (this.clipRun >= this.clipSeconds) return 'clip';

    this.history.push({ t: this.time, frame });
    const keep = Math.max(this.riseSeconds, this.steadySeconds) + 0.2;
    while (this.history.length > 0 && this.history[0].t < this.time - keep) this.history.shift();

    if (this.rising() || this.steady()) return 'howl';
    return 'ok';
  }

  /** Son `seconds` içindeki çerçeveler; pencere henüz dolmadıysa null. */
  private window(seconds: number): GuardFrame[] | null {
    const h = this.history;
    if (h.length < 3 || h[h.length - 1].t - h[0].t < seconds - 1e-9) return null;
    const from = this.time - seconds;
    let i = h.length - 1;
    while (i > 0 && h[i - 1].t >= from - 1e-9) i--;
    return h.slice(i).map((x) => x.frame);
  }

  private tonalSameFreq(frames: GuardFrame[], minTonality: number): boolean {
    const f0 = frames[frames.length - 1].freq;
    if (f0 <= 0) return false;
    return frames.every((f) => f.tonality >= minTonality && Math.abs(f.freq - f0) <= f0 * 0.03 + 25);
  }

  private rising(): boolean {
    const frames = this.window(this.riseSeconds);
    if (!frames) return false;
    const first = frames[0].rms;
    const last = frames[frames.length - 1].rms;
    if (last < 0.05 || first <= 0 || gainToDb(last / first) < this.riseDb) return false;
    // Hiç belirgin düşüş olmadan büyümeli (vuruşlar arası sönüm geri besleme değildir).
    for (let i = 1; i < frames.length; i++) if (frames[i].rms < frames[i - 1].rms * 0.85) return false;
    return this.tonalSameFreq(frames, 0.6);
  }

  private steady(): boolean {
    const frames = this.window(this.steadySeconds);
    if (!frames) return false;
    const first = frames[0].rms;
    const last = frames[frames.length - 1].rms;
    if (Math.min(...frames.map((f) => f.rms)) < 0.25 || last < first * 0.8) return false;
    return this.tonalSameFreq(frames, 0.9);
  }
}
