/** Ses kayıtları için saf mantık: dalga formu, kayıt biçimi, base64 dönüşümü, karşılaştırma zamanlaması. */

/** Kaydın özeti (`items` deposu). Ses verisi aynı kimlikle `blobs` deposunda durur. */
export interface Take {
  id: string;
  type: 'recording';
  date: number;
  name: string;
  /** Süre (saniye). */
  seconds: number;
  /** Dalga formu: 0–100 arası tepe değerleri (liste ekranı sesi çözmeden çizebilsin diye). */
  peaks: number[];
  /** En yüksek seviye (0..1). */
  peak: number;
  mime: string;
  /** Sıkıştırılmış ses verisinin boyutu (bayt). */
  bytes: number;
  [key: string]: unknown;
}

/** Ses verisi (`blobs` deposu). JSON dışa aktarmada bozulmasın diye base64 metin olarak saklanır. */
export interface TakeAudio {
  id: string;
  type: 'recording';
  date: number;
  mime: string;
  base64: string;
  [key: string]: unknown;
}

/** Saklanan dalga formundaki nokta sayısı. */
export const PEAK_BUCKETS = 240;
/** En uzun kayıt (saniye). */
export const MAX_SECONDS = 600;
/** Bu seviyenin üstü kırpılma (clipping) sayılır. */
export const CLIP_LEVEL = 0.985;

export function isTake(v: unknown): v is Take {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<Take>;
  return (
    r.type === 'recording' &&
    typeof r.id === 'string' &&
    typeof r.date === 'number' &&
    typeof r.name === 'string' &&
    typeof r.seconds === 'number' &&
    Array.isArray(r.peaks) &&
    typeof r.mime === 'string'
  );
}

export function isTakeAudio(v: unknown): v is TakeAudio {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<TakeAudio>;
  return r.type === 'recording' && typeof r.id === 'string' && typeof r.mime === 'string' && typeof r.base64 === 'string';
}

/** Örnekleri eşit parçalara bölüp her parçanın en büyük mutlak değerini (0..1) döndürür. */
export function computePeaks(samples: ArrayLike<number>, buckets: number = PEAK_BUCKETS): number[] {
  const n = samples.length;
  const count = Math.max(1, Math.min(buckets, n));
  const out = new Array<number>(count).fill(0);
  if (n === 0) return out;
  for (let b = 0; b < count; b++) {
    const from = Math.floor((b * n) / count);
    const to = Math.max(from + 1, Math.floor(((b + 1) * n) / count));
    let max = 0;
    for (let i = from; i < to && i < n; i++) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    out[b] = Math.min(1, max);
  }
  return out;
}

/** Tepe değerlerini saklamak için 0–100 tam sayıya çevirir. */
export function quantizePeaks(peaks: number[]): number[] {
  return peaks.map((p) => Math.max(0, Math.min(100, Math.round(p * 100))));
}

export function maxLevel(samples: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > max) max = v;
  }
  return max;
}

export function rmsLevel(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Çok kanallı sesi tek kanala indirir (kanalların ortalaması). */
export function mixToMono(channels: ArrayLike<number>[]): Float32Array {
  const n = channels.length ? channels[0].length : 0;
  const out = new Float32Array(n);
  if (channels.length === 0) return out;
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i] / channels.length;
  return out;
}

const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** "1:05" biçiminde süre. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Bayt sayısını "512 kB" / "1,4 MB" gibi okunur biçime çevirir. */
export function formatBytes(bytes: number, decimal = ','): string {
  if (bytes < 1000) return `${Math.max(0, Math.round(bytes))} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`;
  return `${(bytes / 1_000_000).toFixed(1).replace('.', decimal)} MB`;
}

/** Dalga formunda bir yatay konumun (0..1) karşılık geldiği saniye. */
export function seekSeconds(fraction: number, seconds: number): number {
  return Math.max(0, Math.min(1, fraction)) * Math.max(0, seconds);
}

/**
 * Karşılaştırmada iki kayıt aynı andan çalınır; ortak süre uzun olanınkidir.
 * @returns Verilen ortak konumda kaydın kendi içindeki oranı (0..1); kayıt bitmişse 1.
 */
export function cursorFraction(position: number, takeSeconds: number): number {
  if (takeSeconds <= 0) return 0;
  return Math.max(0, Math.min(1, position / takeSeconds));
}

/** Yeni kayıt için ad: aynı güne ait kayıtlar sırayla numaralanır ("Kayıt 3"). */
export function nextTakeNumber(existing: Pick<Take, 'name'>[], prefix: string): number {
  let max = 0;
  for (const t of existing) {
    const m = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`).exec(t.name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Tüm kayıtların kapladığı alan (bayt). */
export function totalBytes(takes: Pick<Take, 'bytes'>[]): number {
  return takes.reduce((sum, t) => sum + (Number(t.bytes) || 0), 0);
}
