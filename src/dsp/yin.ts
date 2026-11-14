import { FFT, nextPow2 } from './fft';

export interface PitchResult {
  /** Hz; perde bulunamadıysa 0. */
  freq: number;
  /** 0..1; 1 = tam periyodik. */
  clarity: number;
  /** Çerçevenin RMS seviyesi (DC çıkarılmış). */
  rms: number;
}

export interface PitchOptions {
  bufferSize?: number;
  minFreq?: number;
  maxFreq?: number;
  /** CMND eşiği (YIN makalesindeki "absolute threshold"). */
  threshold?: number;
  /** Eşik altı çukur bulunamazsa kabul edilecek en kötü CMND değeri. */
  fallbackThreshold?: number;
  /** Analiz öncesi alçak geçiren süzgeç kesimi (Hz). Geniş bantlı gürültüyü bastırır; 0 = kapalı. */
  lowpassHz?: number;
}

/**
 * YIN perde algılayıcı (de Cheveigné & Kawahara, 2002).
 * Fark fonksiyonu FFT tabanlı çapraz korelasyonla hesaplanır: O(N log N).
 */
export class PitchDetector {
  readonly sampleRate: number;
  readonly bufferSize: number;
  private readonly tauMin: number;
  private readonly tauMax: number;
  private readonly window: number;
  private readonly threshold: number;
  private readonly fallbackThreshold: number;
  private readonly fft: FFT;
  private readonly aRe: Float64Array;
  private readonly aIm: Float64Array;
  private readonly bRe: Float64Array;
  private readonly bIm: Float64Array;
  private readonly x: Float64Array;
  private readonly cum: Float64Array;
  private readonly cmnd: Float64Array;
  private readonly lp: { b0: number; b1: number; b2: number; a1: number; a2: number } | null;

  constructor(sampleRate: number, opts: PitchOptions = {}) {
    this.sampleRate = sampleRate;
    this.bufferSize = opts.bufferSize ?? 4096;
    const minFreq = opts.minFreq ?? 50;
    const maxFreq = opts.maxFreq ?? 1500;
    this.threshold = opts.threshold ?? 0.12;
    this.fallbackThreshold = opts.fallbackThreshold ?? 0.4;
    this.tauMax = Math.min(Math.floor(sampleRate / minFreq), Math.floor(this.bufferSize / 2));
    this.tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
    this.window = this.bufferSize - this.tauMax;
    const n = nextPow2(this.bufferSize + this.window);
    this.fft = new FFT(n);
    this.aRe = new Float64Array(n);
    this.aIm = new Float64Array(n);
    this.bRe = new Float64Array(n);
    this.bIm = new Float64Array(n);
    this.x = new Float64Array(this.bufferSize);
    this.cum = new Float64Array(this.bufferSize + 1);
    this.cmnd = new Float64Array(this.tauMax + 2);
    const cutoff = opts.lowpassHz ?? 2800;
    if (cutoff > 0 && cutoff < sampleRate / 2) {
      // RBJ biquad, Butterworth (Q = 1/√2).
      const w0 = (2 * Math.PI * cutoff) / sampleRate;
      const alpha = Math.sin(w0) / Math.SQRT2;
      const cosw = Math.cos(w0);
      const a0 = 1 + alpha;
      this.lp = {
        b0: (1 - cosw) / 2 / a0,
        b1: (1 - cosw) / a0,
        b2: (1 - cosw) / 2 / a0,
        a1: (-2 * cosw) / a0,
        a2: (1 - alpha) / a0,
      };
    } else {
      this.lp = null;
    }
  }

  detect(input: ArrayLike<number>): PitchResult {
    const N = this.bufferSize;
    const W = this.window;
    const { x, cum, cmnd, aRe, aIm, bRe, bIm, tauMax, tauMin } = this;
    if (input.length < N) throw new Error(`PitchDetector needs ${N} samples`);

    let mean = 0;
    for (let i = 0; i < N; i++) mean += input[i];
    mean /= N;
    let energy = 0;
    cum[0] = 0;
    const lp = this.lp;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < N; i++) {
      let v = input[i] - mean;
      if (lp) {
        const out = lp.b0 * v + lp.b1 * x1 + lp.b2 * x2 - lp.a1 * y1 - lp.a2 * y2;
        x2 = x1;
        x1 = v;
        y2 = y1;
        y1 = out;
        v = out;
      }
      x[i] = v;
      energy += v * v;
      cum[i + 1] = energy;
    }
    const rms = Math.sqrt(energy / N);
    if (rms < 1e-6) return { freq: 0, clarity: 0, rms };

    // r[tau] = sum_{j<W} x[j] * x[j+tau]
    aRe.fill(0);
    aIm.fill(0);
    bRe.fill(0);
    bIm.fill(0);
    for (let i = 0; i < W; i++) aRe[i] = x[i];
    for (let i = 0; i < N; i++) bRe[i] = x[i];
    this.fft.forward(aRe, aIm);
    this.fft.forward(bRe, bIm);
    const n = this.fft.size;
    for (let i = 0; i < n; i++) {
      const ar = aRe[i];
      const ai = -aIm[i];
      const br = bRe[i];
      const bi = bIm[i];
      aRe[i] = ar * br - ai * bi;
      aIm[i] = ar * bi + ai * br;
    }
    this.fft.inverse(aRe, aIm);

    // d[tau] = m(0) + m(tau) - 2 r[tau]; ardından kümülatif ortalama ile normalize et.
    const m0 = cum[W];
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      const d = Math.max(0, m0 + (cum[tau + W] - cum[tau]) - 2 * aRe[tau]);
      running += d;
      cmnd[tau] = running > 0 ? (d * tau) / running : 1;
    }

    // Eşik, en derin çukura göre uyarlanır: gürültüde çukurlar sığlaşır ama ilk (en kısa periyotlu)
    // derin çukur hâlâ temel periyottur. Böylece gürültüde oktav hatası yapılmaz.
    let minVal = Infinity;
    for (let tau = tauMin; tau < tauMax; tau++) if (cmnd[tau] < minVal) minVal = cmnd[tau];
    if (minVal > this.fallbackThreshold) return { freq: 0, clarity: Math.max(0, 1 - minVal), rms };
    const limit = Math.max(this.threshold, minVal * 1.25 + 0.03);
    let best = -1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (cmnd[tau] < limit) {
        // Eşiğin altında kalan bölgenin tamamındaki en küçük değeri al
        // (küçük dalgalanmalar yerel çukur gibi görünebilir).
        best = tau;
        for (; tau < tauMax && cmnd[tau] < limit; tau++) if (cmnd[tau] < cmnd[best]) best = tau;
        break;
      }
    }
    if (best < 0) return { freq: 0, clarity: 0, rms };
    // Aralığın ucundaki "en küçük" değer gerçek bir çukur değildir.
    if (best <= tauMin || best >= tauMax - 1) {
      if (!(cmnd[best] < cmnd[best - 1] && cmnd[best] <= cmnd[best + 1])) {
        return { freq: 0, clarity: 0, rms };
      }
    }

    // Parabolik ara değerleme.
    const c0 = cmnd[best - 1];
    const c1 = cmnd[best];
    const c2 = cmnd[best + 1];
    const denom = c0 - 2 * c1 + c2;
    let shift = 0;
    let minY = c1;
    if (denom > 1e-12) {
      shift = (0.5 * (c0 - c2)) / denom;
      if (shift > 1) shift = 1;
      if (shift < -1) shift = -1;
      minY = c1 - 0.25 * (c0 - c2) * shift;
    }
    const tau = best + shift;
    return { freq: this.sampleRate / tau, clarity: Math.min(1, Math.max(0, 1 - minY)), rms };
  }
}
