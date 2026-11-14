/** Temel müzik teorisi: nota adları, akor türleri, akor simgesi ayrıştırma. */

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
/** Akor köklerinde en sık kullanılan yazım. */
export const COMMON_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export type Quality =
  | 'maj'
  | 'min'
  | '7'
  | 'maj7'
  | 'm7'
  | 'sus2'
  | 'sus4'
  | '5'
  | 'dim'
  | 'aug'
  | 'add9'
  | 'm7b5'
  | 'dim7'
  | '6'
  | 'm6'
  | '9';

export const QUALITIES: Record<Quality, { suffix: string; intervals: number[] }> = {
  maj: { suffix: '', intervals: [0, 4, 7] },
  min: { suffix: 'm', intervals: [0, 3, 7] },
  '7': { suffix: '7', intervals: [0, 4, 7, 10] },
  maj7: { suffix: 'maj7', intervals: [0, 4, 7, 11] },
  m7: { suffix: 'm7', intervals: [0, 3, 7, 10] },
  sus2: { suffix: 'sus2', intervals: [0, 2, 7] },
  sus4: { suffix: 'sus4', intervals: [0, 5, 7] },
  '5': { suffix: '5', intervals: [0, 7] },
  dim: { suffix: 'dim', intervals: [0, 3, 6] },
  aug: { suffix: 'aug', intervals: [0, 4, 8] },
  add9: { suffix: 'add9', intervals: [0, 2, 4, 7] },
  m7b5: { suffix: 'm7b5', intervals: [0, 3, 6, 10] },
  dim7: { suffix: 'dim7', intervals: [0, 3, 6, 9] },
  '6': { suffix: '6', intervals: [0, 4, 7, 9] },
  m6: { suffix: 'm6', intervals: [0, 3, 7, 9] },
  '9': { suffix: '9', intervals: [0, 2, 4, 7, 10] },
};

const SUFFIX_ALIASES: Record<string, Quality> = {
  '': 'maj',
  M: 'maj',
  maj: 'maj',
  m: 'min',
  min: 'min',
  '-': 'min',
  '7': '7',
  dom7: '7',
  maj7: 'maj7',
  M7: 'maj7',
  'Δ': 'maj7',
  m7: 'm7',
  min7: 'm7',
  '-7': 'm7',
  sus2: 'sus2',
  sus4: 'sus4',
  sus: 'sus4',
  '5': '5',
  dim: 'dim',
  '°': 'dim',
  aug: 'aug',
  '+': 'aug',
  add9: 'add9',
  m7b5: 'm7b5',
  'ø': 'm7b5',
  dim7: 'dim7',
  '°7': 'dim7',
  '6': '6',
  m6: 'm6',
  '9': '9',
};

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** "F#", "Bb" gibi bir nota adını perde sınıfına (0–11) çevirir; geçersizse null. */
export function parseNoteName(name: string): number | null {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(name.trim());
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return mod12(LETTER_PC[m[1].toUpperCase()] + acc);
}

export interface ParsedChord {
  root: number;
  quality: Quality;
  /** Bölü akorlarında bas notası (perde sınıfı). */
  bass?: number;
}

/** "Am", "F#m7", "C/G", "Bbmaj7" gibi akor simgelerini ayrıştırır; tanınmazsa null. */
export function parseChord(symbol: string): ParsedChord | null {
  const m = /^([A-G])([#b♯♭]?)([^/\s]*)(?:\/([A-G][#b♯♭]?))?$/.exec(symbol.trim());
  if (!m) return null;
  const root = parseNoteName(m[1] + m[2]);
  const quality = SUFFIX_ALIASES[m[3]];
  if (root === null || quality === undefined) return null;
  const parsed: ParsedChord = { root, quality };
  if (m[4]) {
    const bass = parseNoteName(m[4]);
    if (bass === null) return null;
    parsed.bass = bass;
  }
  return parsed;
}

export function chordSymbol(root: number, quality: Quality, names: readonly string[] = COMMON_NAMES): string {
  return names[mod12(root)] + QUALITIES[quality].suffix;
}

/** Akorun perde sınıfları (kökten başlayarak). */
export function chordPitchClasses(root: number, quality: Quality): number[] {
  return QUALITIES[quality].intervals.map((i) => mod12(root + i));
}

/** Akor simgesini yarım ton sayısı kadar kaydırır; tanınmayan simgeyi olduğu gibi döndürür. */
export function transposeChord(symbol: string, semitones: number, names: readonly string[] = COMMON_NAMES): string {
  const p = parseChord(symbol);
  if (!p) return symbol;
  const base = chordSymbol(p.root + semitones, p.quality, names);
  return p.bass === undefined ? base : `${base}/${names[mod12(p.bass + semitones)]}`;
}
