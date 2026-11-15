import { FFT, hann, nextPow2 } from './fft';

export interface ChromaOptions {
  /** Analiz penceresi (saniye). Uzun pencere = iyi frekans çözünürlüğü (kalın teller için gerekli). */
  frameSeconds?: number;
  minFreq?: number;
  maxFreq?: number;
  /** Referans A4 frekansı (Hz). */
  a4?: number;
  /** En güçlü tepeye göre bu oranın altındaki tepeler yok sayılır. */
  peakFloor?: number;
}

export interface ChromaFrame {
  /** 12 perde sınıfının (C, C#, … B) göreli gücü; en büyüğü 1. Sessizlikte hepsi 0. */
  chroma: Float32Array;
  /** En kalın belirgin sesin perde sınıfı (akorun bas notası); bulunamazsa -1. */
  bass: number;
  /** Çerçevenin RMS seviyesi. */
  rms: number;
}

/**
 * Kroma (HPCP benzeri) çıkarıcı: spektrumdaki tepeler bulunur, frekansları ince ayarlanır ve
 * her tepe en yakın perde sınıflarına cos² ağırlığıyla dağıtılır. Böylece hafif akortsuzluk
 * tolere edilir ve tepeler arasındaki gürültü kromaya karışmaz.
 */
export class ChromaExtractor {
  readonly frameSize: number;
  private readonly sampleRate: number;
  private readonly fft: FFT;
  private readonly window: Float64Array;
  private readonly re: Float64Array;
  private readonly im: Float64Array;
  private readonly mag: Float64Array;
  private readonly minBin: number;
  private readonly maxBin: number;
  private readonly a4: number;
  private readonly peakFloor: number;

  constructor(sampleRate: number, opts: ChromaOptions = {}) {
    this.sampleRate = sampleRate;
    this.frameSize = nextPow2(Math.round(sampleRate * (opts.frameSeconds ?? 0.16)));
    this.fft = new FFT(this.frameSize);
    this.window = hann(this.frameSize);
    this.re = new Float64Array(this.frameSize);
    this.im = new Float64Array(this.frameSize);
    this.mag = new Float64Array(this.frameSize / 2);
    const binHz = sampleRate / this.frameSize;
    this.minBin = Math.max(2, Math.floor((opts.minFreq ?? 62) / binHz));
    this.maxBin = Math.min(this.frameSize / 2 - 2, Math.ceil((opts.maxFreq ?? 2100) / binHz));
    this.a4 = opts.a4 ?? 440;
    this.peakFloor = opts.peakFloor ?? 0.03;
  }

  compute(frame: ArrayLike<number>): ChromaFrame {
    const n = this.frameSize;
    if (frame.length < n) throw new Error(`ChromaExtractor needs ${n} samples`);
    const { re, im, mag, window } = this;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const v = frame[i];
      sumSq += v * v;
      re[i] = v * window[i];
      im[i] = 0;
    }
    const rms = Math.sqrt(sumSq / n);
    const chroma = new Float32Array(12);
    if (rms < 1e-5) return { chroma, bass: -1, rms };

    this.fft.forward(re, im);
    let maxMag = 0;
    for (let k = this.minBin - 1; k <= this.maxBin + 1; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      if (m > maxMag) maxMag = m;
    }
    const floor = maxMag * this.peakFloor;
    const binHz = this.sampleRate / n;
    const energy = new Float64Array(12);
    let lowMax = 0;
    const low: { freq: number; mag: number }[] = [];

    for (let k = this.minBin; k <= this.maxBin; k++) {
      const m = mag[k];
      if (m < floor || m <= mag[k - 1] || m < mag[k + 1]) continue;
      // Logaritmik genlikte parabolik ara değerleme: tepenin gerçek frekansı.
      const a = Math.log(mag[k - 1] + 1e-12);
      const b = Math.log(m);
      const c = Math.log(mag[k + 1] + 1e-12);
      const denom = a - 2 * b + c;
      const shift = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
      const freq = (k + shift) * binHz;
      const midi = 69 + 12 * Math.log2(freq / this.a4);
      const nearest = Math.round(midi);
      // cos² penceresi: genişlik 4/3 yarım ton (HPCP).
      for (const note of [nearest - 1, nearest, nearest + 1]) {
        const d = Math.abs(midi - note);
        if (d >= 2 / 3) continue;
        const w = Math.cos((Math.PI * d) / (4 / 3)) ** 2;
        energy[((note % 12) + 12) % 12] += w * m * m;
      }
      if (freq < 400) {
        low.push({ freq, mag: m });
        if (m > lowMax) lowMax = m;
      }
    }

    let max = 0;
    for (let i = 0; i < 12; i++) {
      // Güçlü sıkıştırma (0,3. kuvvet): zayıf çınlayan akor notaları (ör. üçlü) da şablonla eşleşebilsin.
      const v = Math.pow(energy[i], 0.3);
      chroma[i] = v;
      if (v > max) max = v;
    }
    if (max > 0) for (let i = 0; i < 12; i++) chroma[i] /= max;

    // Bas: alçak bölgedeki en güçlü tepenin en az üçte biri kadar güçlü olan en kalın tepe.
    let bass = -1;
    for (const p of low) {
      if (p.mag >= lowMax * 0.33) {
        bass = (((Math.round(69 + 12 * Math.log2(p.freq / this.a4)) % 12) + 12) % 12);
        break;
      }
    }
    return { chroma, bass, rms };
  }
}
