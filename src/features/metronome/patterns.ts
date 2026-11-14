import type { Key } from '../../i18n';

/** D = aşağı, U = yukarı, X = susturulmuş vuruş, - = boş (el geçer, tele değmez). */
export type Stroke = 'D' | 'U' | 'X' | '-';
export const STROKES: Stroke[] = ['-', 'D', 'U', 'X'];

export interface StrumPattern {
  id: string;
  /** Hazır kalıplarda çeviri anahtarı, kullanıcı kalıplarında serbest ad. */
  name: string;
  nameKey?: Key;
  /** Ölçüdeki vuruş sayısı. */
  beats: number;
  /** Vuruş başına hücre sayısı (1, 2 ya da 4). */
  division: number;
  slots: Stroke[];
  custom?: boolean;
}

export interface Meter {
  id: string;
  beats: number;
  /** Varsayılan vurgular: 2 = vurgulu, 1 = normal, 0 = sessiz. */
  accents: number[];
}

export const METERS: Meter[] = [
  { id: '2/4', beats: 2, accents: [2, 1] },
  { id: '3/4', beats: 3, accents: [2, 1, 1] },
  { id: '4/4', beats: 4, accents: [2, 1, 1, 1] },
  { id: '5/4', beats: 5, accents: [2, 1, 1, 2, 1] },
  { id: '6/8', beats: 6, accents: [2, 1, 1, 2, 1, 1] },
  { id: '7/8', beats: 7, accents: [2, 1, 2, 1, 2, 1, 1] },
];

export function getMeter(id: string): Meter {
  return METERS.find((m) => m.id === id) ?? METERS[2];
}

const p = (s: string): Stroke[] => s.split(' ') as Stroke[];

/** Hazır vuruş kalıpları. Hepsi genel ritim kalıplarıdır; belirli bir şarkıya ait değildir. */
export const PRESET_PATTERNS: StrumPattern[] = [
  { id: 'q4', name: '', nameKey: 'strum.quarters', beats: 4, division: 2, slots: p('D - D - D - D -') },
  { id: 'e8', name: '', nameKey: 'strum.eighths', beats: 4, division: 2, slots: p('D U D U D U D U') },
  { id: 'basic', name: '', nameKey: 'strum.basic', beats: 4, division: 2, slots: p('D - D U D - D U') },
  { id: 'folk', name: '', nameKey: 'strum.folk', beats: 4, division: 2, slots: p('D - D U - U D U') },
  { id: 'sync', name: '', nameKey: 'strum.syncopated', beats: 4, division: 2, slots: p('D - - U - U D U') },
  { id: 'mute', name: '', nameKey: 'strum.muted', beats: 4, division: 2, slots: p('D U X U D U X U') },
  {
    id: 'funk16',
    name: '',
    nameKey: 'strum.sixteenth',
    beats: 4,
    division: 4,
    slots: p('D - D U - U D U D - D U - U D U'),
  },
  { id: 'waltz', name: '', nameKey: 'strum.waltz', beats: 3, division: 2, slots: p('D - D U D U') },
  { id: 'q3', name: '', nameKey: 'strum.quarters', beats: 3, division: 2, slots: p('D - D - D -') },
  { id: 'e2', name: '', nameKey: 'strum.eighths', beats: 2, division: 2, slots: p('D U D U') },
  { id: 'six', name: '', nameKey: 'strum.sixEight', beats: 6, division: 1, slots: p('D D U D D U') },
  { id: 'sixflow', name: '', nameKey: 'strum.sixEightFlow', beats: 6, division: 2, slots: p('D - D U D U D - D U D U') },
];

export function emptyPattern(beats: number, division: number): Stroke[] {
  // Başlangıç: her vuruşta aşağı.
  return Array.from({ length: beats * division }, (_, i) => (i % division === 0 ? 'D' : '-'));
}

/** Bölme değişince kalıbı yeni ızgaraya taşır (vuruşların yeri korunur). */
export function resizePattern(slots: Stroke[], beats: number, from: number, to: number): Stroke[] {
  const out: Stroke[] = Array.from({ length: beats * to }, () => '-' as Stroke);
  slots.forEach((s, i) => {
    const pos = (i * to) / from;
    if (Number.isInteger(pos) && pos < out.length) out[pos] = s;
  });
  return out;
}

export function nextStroke(s: Stroke): Stroke {
  return STROKES[(STROKES.indexOf(s) + 1) % STROKES.length];
}

/** Sayma etiketi: "1 & 2 &", "1 e & a" … */
export function slotLabel(index: number, division: number): string {
  const sub = index % division;
  if (sub === 0) return String(Math.floor(index / division) + 1);
  if (division === 2) return '&';
  if (division === 4) return ['', 'e', '&', 'a'][sub];
  return '·';
}

/**
 * Saat adımını kalıp hücresine çevirir.
 * @returns Adım bir hücreye denk geliyorsa hücre sırası, yoksa -1.
 */
export function slotForStep(beat: number, sub: number, stepsPerBeat: number, division: number): number {
  const every = stepsPerBeat / division;
  if (!Number.isInteger(every) || sub % every !== 0) return -1;
  return beat * division + sub / every;
}

export function isValidPattern(v: unknown): v is StrumPattern {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<StrumPattern>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    typeof o.beats === 'number' &&
    typeof o.division === 'number' &&
    Array.isArray(o.slots) &&
    o.slots.length === o.beats * o.division &&
    o.slots.every((s) => STROKES.includes(s))
  );
}
