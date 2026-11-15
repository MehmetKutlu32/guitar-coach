/** Kendi ses dosyasıyla çalışma: kayıt biçimi, sınırlar, döngü ve gösterim için saf mantık. */

export interface Track {
  id: string;
  type: 'track';
  date: number;
  name: string;
  seconds: number;
  /** Dalga formu: 0–100 arası tepe değerleri. */
  peaks: number[];
  mime: string;
  bytes: number;
  /** Çalma hızı (%). */
  speed: number;
  /** Ton kaydırma (yarım ton). */
  semitones: number;
  /** A–B döngüsü (saniye); yoksa null. */
  loopA: number | null;
  loopB: number | null;
  [key: string]: unknown;
}

export interface TrackAudio {
  id: string;
  type: 'track';
  date: number;
  mime: string;
  base64: string;
  [key: string]: unknown;
}

export const MAX_FILE_BYTES = 20_000_000;
export const MAX_TRACK_SECONDS = 12 * 60;
export const MIN_SPEED_PERCENT = 25;
export const MAX_SPEED_PERCENT = 150;
export const SPEED_STEP = 5;
export const MAX_SHIFT = 12;
/** En kısa döngü (saniye). */
export const MIN_LOOP = 0.25;
export const TRACK_PEAKS = 360;

export function isTrack(v: unknown): v is Track {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<Track>;
  return (
    r.type === 'track' &&
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    typeof r.seconds === 'number' &&
    Array.isArray(r.peaks) &&
    typeof r.speed === 'number' &&
    typeof r.semitones === 'number'
  );
}

export function isTrackAudio(v: unknown): v is TrackAudio {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<TrackAudio>;
  return r.type === 'track' && typeof r.id === 'string' && typeof r.base64 === 'string';
}

/** Dosya adından parça adı: uzantı atılır, alt çizgiler boşluk olur. */
export function trackName(fileName: string): string {
  const base = fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_]+/g, ' ').trim();
  return (base || fileName.trim() || '?').slice(0, 80);
}

export type FileProblem = 'tooBig' | 'tooLong' | null;

export function checkSize(bytes: number): FileProblem {
  return bytes > MAX_FILE_BYTES ? 'tooBig' : null;
}

export function checkLength(seconds: number): FileProblem {
  return seconds > MAX_TRACK_SECONDS ? 'tooLong' : null;
}

export function clampSpeed(percent: number): number {
  const stepped = Math.round(percent / SPEED_STEP) * SPEED_STEP;
  return Math.min(MAX_SPEED_PERCENT, Math.max(MIN_SPEED_PERCENT, stepped));
}

export function clampShift(semitones: number): number {
  return Math.min(MAX_SHIFT, Math.max(-MAX_SHIFT, Math.round(semitones)));
}

export interface Loop {
  a: number | null;
  b: number | null;
}

/** Döngü etkin mi: iki uç da belli ve arası yeterince uzun. */
export function loopActive(loop: Loop): loop is { a: number; b: number } {
  return loop.a !== null && loop.b !== null && loop.b - loop.a >= MIN_LOOP;
}

/** A ucunu ayarlar. A, B'nin gerisinde kalmazsa B silinir (yeni bir döngü başlatılıyor demektir). */
export function setLoopStart(loop: Loop, position: number, duration: number): Loop {
  const a = Math.max(0, Math.min(duration, position));
  if (loop.b !== null && loop.b - a < MIN_LOOP) return { a, b: null };
  return { a, b: loop.b };
}

/** B ucunu ayarlar. A yoksa parçanın başı alınır; B, A'dan yeterince ileride değilse değişiklik yapılmaz. */
export function setLoopEnd(loop: Loop, position: number, duration: number): Loop {
  const a = loop.a ?? 0;
  const b = Math.max(0, Math.min(duration, position));
  if (b - a < MIN_LOOP) return loop;
  return { a, b };
}

/** "1:05.3" biçiminde konum (onda bir saniye). */
export function formatClock(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}

/** "+2", "−3", "0" biçiminde yarım ton. */
export function shiftLabel(semitones: number): string {
  if (semitones === 0) return '0';
  return semitones > 0 ? `+${semitones}` : `−${Math.abs(semitones)}`;
}

/** İleri/geri atlamada yeni konum; döngü etkinse döngü içinde kalır. */
export function skipTo(position: number, delta: number, duration: number, loop: Loop): number {
  const target = Math.max(0, Math.min(duration, position + delta));
  if (loopActive(loop)) return Math.max(loop.a, Math.min(loop.b - 0.05, target));
  return target;
}
