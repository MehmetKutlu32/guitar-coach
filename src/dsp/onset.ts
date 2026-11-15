import { FFT, hann, nextPow2 } from './fft';

export interface OnsetOptions {
  /** Analiz penceresi (ms). */
  frameMs?: number;
  /** Pencereler arası adım (ms). Zaman çözünürlüğünü belirler. */
  hopMs?: number;
  /** Logaritmik sıkıştırma katsayısı: büyüdükçe zayıf vuruşlar güçlülerle eşitlenir, gürültü de büyür. */
  gamma?: number;
  /** Vuruş sayılması için akının, yakın geçmiş ortalamasının kaç katı olması gerektiği. */
  lambda?: number;
  /** Mutlak akı tabanı (frekans kutusu başına). */
  delta?: number;
  /** İki vuruş arasındaki en kısa süre (ms). */
  minGapMs?: number;
  /** Eşik ortalamasının uzunluğu (ms). */
  windowMs?: number;
}

/**
 * Vuruş (onset) algılayıcı — logaritmik spektral akı.
 *
 * Kısa pencerelerin genlik spektrumu logaritmik sıkıştırılır ve bir önceki pencereye göre
 * yalnızca ARTIŞLAR toplanır. Çınlayan teller (sabit ya da sönen bileşenler) akı üretmez;
 * yeni bir vuruş ise birçok frekansta birden artış yaratır. Zaman alanındaki enerji
 * karşılaştırması, çınlayan akorun üstüne gelen vuruşları ve güçlü vuruştan sonraki zayıf
 * vuruşları kaçırıyordu (bkz. DECISIONS.md).
 *
 * Örnek örnek beslenir; AudioWorklet içinde kullanılır ve Node'da sınanır.
 */
export class OnsetDetector {
  readonly frameSize: number;
  readonly hop: number;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly ring: Float32Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly prevLog: Float64Array[];
  private readonly bins: number;
  private readonly gamma: number;
  private readonly lambda: number;
  private readonly delta: number;
  private readonly minGap: number;
  private readonly fluxHistory: Float64Array;
  private readonly bias: number;
  private histPos = 0;
  private histCount = 0;
  private write = 0;
  private sinceHop = 0;
  private total = 0;
  private frames = 0;
  /** Son üç pencerenin akısı ve bitiş örneği (yerel tepe araması için). */
  private f1 = 0;
  private f2 = 0;
  private end1 = 0;
  private lastOnset = -Infinity;

  constructor(sampleRate: number, opts: OnsetOptions = {}) {
    this.frameSize = nextPow2(Math.round((sampleRate * (opts.frameMs ?? 20)) / 1000));
    this.hop = Math.max(16, Math.round((sampleRate * (opts.hopMs ?? 2.67)) / 1000));
    this.fft = new FFT(this.frameSize);
    this.window = hann(this.frameSize);
    this.ring = new Float32Array(this.frameSize);
    this.re = new Float64Array(this.frameSize);
    this.im = new Float64Array(this.frameSize);
    this.bins = this.frameSize / 2;
    this.prevLog = [new Float64Array(this.bins), new Float64Array(this.bins)];
    this.gamma = opts.gamma ?? 300;
    this.lambda = opts.lambda ?? 2.2;
    this.delta = (opts.delta ?? 0.012) * this.bins;
    this.minGap = Math.round((sampleRate * (opts.minGapMs ?? 50)) / 1000);
    const histLen = Math.max(8, Math.round((opts.windowMs ?? 100) / ((this.hop / sampleRate) * 1000)));
    this.fluxHistory = new Float64Array(histLen);
    // Hann penceresi en yeni örnekleri sıfıra yakın ağırlıklar: atak, pencereye girdikten bir süre
    // sonra akıda görünür. Bu sabit gecikme düşülür (değer üretilmiş sinyallerle ölçüldü).
    this.bias = Math.round(this.frameSize * 0.4);
  }

  /**
   * @param block Mono örnekler.
   * @param startSample `block[0]`ın mutlak örnek sırası.
   * @param emit Her vuruş için çağrılır: vuruşun başladığı (tahmini) örnek ve gücü.
   */
  process(block: ArrayLike<number>, startSample: number, emit: (sample: number, strength: number) => void): void {
    const n = this.frameSize;
    for (let i = 0; i < block.length; i++) {
      this.ring[this.write] = block[i];
      this.write = (this.write + 1) % n;
      this.total++;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        if (this.total >= n) this.onFrame(startSample + i + 1, emit);
      }
    }
  }

  private onFrame(endSample: number, emit: (sample: number, strength: number) => void): void {
    const n = this.frameSize;
    const { re, im, window, ring } = this;
    for (let i = 0; i < n; i++) {
      re[i] = ring[(this.write + i) % n] * window[i];
      im[i] = 0;
    }
    this.fft.forward(re, im);

    // İki pencere öncesine göre artışlar: yavaş ataklarda da belirgin bir tepe verir.
    const older = this.prevLog[this.frames % 2];
    const scale = this.gamma / (n / 4);
    let flux = 0;
    for (let k = 1; k < this.bins; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const v = Math.log(1 + scale * mag);
      const d = v - older[k];
      if (d > 0) flux += d;
      older[k] = v;
    }
    this.frames++;
    if (this.frames <= 2) {
      this.f2 = this.f1 = 0;
      this.end1 = endSample;
      return;
    }

    // Aday: bir önceki pencere. Yerel tepe mi ve eşiğin üstünde mi?
    const candidate = this.f1;
    if (candidate > this.f2 && candidate >= flux) {
      let mean = 0;
      const count = Math.min(this.histCount, this.fluxHistory.length);
      for (let j = 0; j < count; j++) mean += this.fluxHistory[j];
      mean = count > 0 ? mean / count : 0;
      const start = this.end1 - this.bias;
      if (candidate > mean * this.lambda + this.delta && start - this.lastOnset >= this.minGap) {
        this.lastOnset = start;
        emit(Math.max(0, start), candidate / this.bins);
      }
    }
    // Geçmişe, adaydan önceki pencereyi ekle (aday kendi eşiğini yükseltmesin).
    this.fluxHistory[this.histPos] = this.f2;
    this.histPos = (this.histPos + 1) % this.fluxHistory.length;
    this.histCount++;
    this.f2 = this.f1;
    this.f1 = flux;
    this.end1 = endSample;
  }

  reset(): void {
    this.ring.fill(0);
    this.prevLog[0].fill(0);
    this.prevLog[1].fill(0);
    this.fluxHistory.fill(0);
    this.histPos = 0;
    this.histCount = 0;
    this.write = 0;
    this.sinceHop = 0;
    this.total = 0;
    this.frames = 0;
    this.f1 = 0;
    this.f2 = 0;
    this.lastOnset = -Infinity;
  }
}

/** Bir sinyalin tamamındaki vuruşları bulur (testler ve çevrimdışı analiz için). */
export function detectOnsets(signal: ArrayLike<number>, sampleRate: number, opts: OnsetOptions = {}): number[] {
  const det = new OnsetDetector(sampleRate, opts);
  const out: number[] = [];
  const BLOCK = 128;
  const buf = new Float32Array(BLOCK);
  for (let start = 0; start < signal.length; start += BLOCK) {
    const len = Math.min(BLOCK, signal.length - start);
    for (let i = 0; i < len; i++) buf[i] = signal[start + i];
    det.process(len === BLOCK ? buf : buf.subarray(0, len), start, (s) => out.push(s));
  }
  return out;
}
