/** Tekrarlanabilir gürültü için küçük PRNG. */
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

export interface PluckOptions {
  /** 0..1 — pena sertliği / parlaklık. */
  brightness?: number;
  /** Sönüm süresi (T60, saniye). Verilmezse perdeye göre seçilir. */
  decay?: number;
  /** Telin neresinden vurulduğu (0..0.5). */
  pickPosition?: number;
  /** 0..1 çıkış tepe seviyesi. */
  velocity?: number;
  seed?: number;
  /** Bu süreden sonra tel susturulur (saniye). */
  muteAt?: number;
}

/**
 * Karplus-Strong tel sentezi (Jaffe-Smith akort düzeltmeli).
 * Döngü gecikmesi = N (tam) + 0.5 (ortalama filtresi) + d (allpass) = sampleRate / freq.
 */
export function pluck(freq: number, sampleRate: number, duration: number, opts: PluckOptions = {}): Float32Array {
  const length = Math.max(1, Math.round(duration * sampleRate));
  const out = new Float32Array(length);
  const period = sampleRate / freq;
  if (!(period > 3)) return out;

  const loopDelay = period - 0.5;
  let n = Math.floor(loopDelay);
  let d = loopDelay - n;
  if (d < 0.15) {
    n -= 1;
    d += 1;
  }
  const c = (1 - d) / (1 + d);

  const brightness = opts.brightness ?? 0.6;
  const t60 = opts.decay ?? Math.min(4.5, Math.max(1.2, 4.2 - 0.9 * Math.log2(freq / 82.4)));
  const g = Math.pow(10, -3 / (freq * t60));
  const rand = mulberry32(opts.seed ?? 1);

  // Uyarım: ideal çekilmiş tel biçimi (pena konumunda tepe yapan üçgen) + biraz gürültü.
  // Üçgenin harmonikleri sin(kπp)/k² ile azalır; temel ses her zaman baskındır.
  const buf = new Float64Array(n);
  const pickPos = Math.min(0.5, Math.max(0.05, opts.pickPosition ?? 0.18));
  const peakIdx = pickPos * n;
  const lp = 0.1 + 0.9 * brightness;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const tri = i < peakIdx ? i / peakIdx : (n - i) / (n - peakIdx);
    const white = rand() * 2 - 1;
    prev += lp * (white - prev);
    buf[i] = tri + prev * 0.35 * brightness;
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    buf[i] -= mean;
    peak = Math.max(peak, Math.abs(buf[i]));
  }
  const scale = (opts.velocity ?? 0.8) / peak;
  for (let i = 0; i < n; i++) buf[i] *= scale;

  const muteSample = opts.muteAt !== undefined ? Math.round(opts.muteAt * sampleRate) : Infinity;
  const muteGain = Math.pow(10, -3 / (freq * 0.06));
  let idx = 0;
  let prevY = 0;
  let apX = 0;
  let apY = 0;
  for (let i = 0; i < length; i++) {
    const y = buf[idx];
    const avg = 0.5 * (y + prevY);
    prevY = y;
    const ap = c * avg + apX - c * apY;
    apX = avg;
    apY = ap;
    buf[idx] = ap * (i >= muteSample ? muteGain : g);
    out[i] = y;
    idx++;
    if (idx === n) idx = 0;
  }
  // Tıkırtıyı önlemek için kısa bitiş yumuşatması.
  const fade = Math.min(length, Math.round(0.01 * sampleRate));
  for (let i = 0; i < fade; i++) out[length - 1 - i] *= i / fade;
  return out;
}

/** Test ve sentez için saf sinüs. */
export function sine(freq: number, sampleRate: number, duration: number, amp = 0.5, phase = 0): Float32Array {
  const length = Math.round(duration * sampleRate);
  const out = new Float32Array(length);
  const w = (2 * Math.PI * freq) / sampleRate;
  for (let i = 0; i < length; i++) out[i] = amp * Math.sin(w * i + phase);
  return out;
}

/** Sinyale beyaz gürültü ekler (yeni dizi döndürür). */
export function addNoise(signal: Float32Array, noiseRms: number, seed = 7): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(signal.length);
  const amp = noiseRms * Math.sqrt(3); // tekdüze dağılımın RMS'i = amp / sqrt(3)
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] + (rand() * 2 - 1) * amp;
  return out;
}

export function rmsOf(signal: ArrayLike<number>, start = 0, end = signal.length): number {
  let s = 0;
  for (let i = start; i < end; i++) s += signal[i] * signal[i];
  return Math.sqrt(s / Math.max(1, end - start));
}
