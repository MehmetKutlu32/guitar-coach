import type { Key } from '../i18n';
import { namesForMajorKey, type ScaleId } from './scales';
import { chordSymbol, COMMON_NAMES, mod12, parseChord, QUALITIES, type Quality } from './theory';

export interface ProgChord {
  root: number;
  quality: Quality;
  symbol: string;
}

/** Bir ölçüdeki akorlar; ölçü akorlar arasında eşit bölünür. */
export type Bar = ProgChord[];

export type ProgMode = 'major' | 'minor' | 'blues';

export interface ProgressionTemplate {
  id: string;
  name: Key;
  /** Roma rakamlarıyla dizi; ölçüler "|" ile ayrılır. */
  roman: string;
  mode: ProgMode;
  /** Bu dizi üzerinde doğaçlama için önerilen gamlar (tonun kökünden). */
  scales: ScaleId[];
}

/** Hazır diziler. Hepsi genel armonik kalıplardır; belirli bir esere ait değildir. */
export const TEMPLATES: ProgressionTemplate[] = [
  {
    id: 'blues12',
    name: 'prog.blues12',
    roman: 'I7 | IV7 | I7 | I7 | IV7 | IV7 | I7 | I7 | V7 | IV7 | I7 | V7',
    mode: 'blues',
    scales: ['minorPent', 'blues', 'mixolydian'],
  },
  { id: 'pop1564', name: 'prog.pop1564', roman: 'I | V | vi | IV', mode: 'major', scales: ['majorPent', 'major'] },
  { id: 'pop6415', name: 'prog.pop6415', roman: 'vi | IV | I | V', mode: 'major', scales: ['majorPent', 'major'] },
  { id: 'fifties', name: 'prog.fifties', roman: 'I | vi | IV | V', mode: 'major', scales: ['majorPent', 'major'] },
  { id: 'rock145', name: 'prog.rock145', roman: 'I | IV | V | IV', mode: 'major', scales: ['majorPent', 'major'] },
  { id: 'jazz251', name: 'prog.jazz251', roman: 'ii7 | V7 | Imaj7 | Imaj7', mode: 'major', scales: ['major', 'majorPent'] },
  {
    id: 'canon',
    name: 'prog.canon',
    roman: 'I | V | vi | iii | IV | I | IV | V',
    mode: 'major',
    scales: ['major', 'majorPent'],
  },
  { id: 'mixo', name: 'prog.mixo', roman: 'I | bVII | IV | I', mode: 'major', scales: ['mixolydian', 'minorPent'] },
  { id: 'minorRock', name: 'prog.minorRock', roman: 'i | bVII | bVI | bVII', mode: 'minor', scales: ['minorPent', 'minor'] },
  { id: 'minorPop', name: 'prog.minorPop', roman: 'i | bVI | bIII | bVII', mode: 'minor', scales: ['minorPent', 'minor'] },
  { id: 'minor145', name: 'prog.minor145', roman: 'i | iv | v | i', mode: 'minor', scales: ['minorPent', 'minor'] },
  {
    id: 'andalusian',
    name: 'prog.andalusian',
    roman: 'i | bVII | bVI | V',
    mode: 'minor',
    scales: ['minor', 'harmonicMinor'],
  },
  {
    id: 'minorBlues',
    name: 'prog.minorBlues',
    roman: 'i7 | iv7 | i7 | i7 | iv7 | iv7 | i7 | i7 | bVI7 | V7 | i7 | V7',
    mode: 'minor',
    scales: ['minorPent', 'blues'],
  },
  { id: 'dorianVamp', name: 'prog.dorianVamp', roman: 'i7 | i7 | IV7 | IV7', mode: 'minor', scales: ['dorian', 'minorPent'] },
  { id: 'funkVamp', name: 'prog.funkVamp', roman: 'I7 | I7 | I7 | I7', mode: 'blues', scales: ['minorPent', 'mixolydian'] },
];

const DEGREES: Record<string, number> = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };

const ROMAN_SUFFIX: Record<string, [upper: Quality, lower: Quality]> = {
  '': ['maj', 'min'],
  '7': ['7', 'm7'],
  maj7: ['maj7', 'maj7'],
  dim: ['dim', 'dim'],
  m7b5: ['m7b5', 'm7b5'],
  sus4: ['sus4', 'sus4'],
  sus2: ['sus2', 'sus2'],
  '6': ['6', 'm6'],
  '9': ['9', '9'],
  '5': ['5', '5'],
};

/** "bVII", "ii7", "Imaj7" gibi bir roma rakamını tonik köküne göre yarım ton ve akor türüne çevirir. */
export function parseRoman(token: string): { semitones: number; quality: Quality } | null {
  const m = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(token.trim());
  if (!m) return null;
  const upper = m[2] === m[2].toUpperCase();
  const suffix = ROMAN_SUFFIX[m[3]];
  if (!suffix) return null;
  const acc = m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
  return { semitones: mod12(DEGREES[m[2].toLowerCase()] + acc), quality: upper ? suffix[0] : suffix[1] };
}

/** Bir ton için akor adlarında kullanılacak nota yazımı. */
export function namesForKey(root: number, mode: ProgMode): readonly string[] {
  return namesForMajorKey(mode === 'minor' ? root + 3 : root);
}

/** Hazır diziyi verilen tonda akorlara çevirir. */
export function resolveTemplate(template: ProgressionTemplate, keyRoot: number): Bar[] {
  const names = namesForKey(keyRoot, template.mode);
  return template.roman.split('|').map((bar) =>
    bar
      .trim()
      .split(/\s+/)
      .map((token) => {
        const r = parseRoman(token);
        if (!r) throw new Error(`Geçersiz roma rakamı: ${token}`);
        const root = mod12(keyRoot + r.semitones);
        return { root, quality: r.quality, symbol: chordSymbol(root, r.quality, names) };
      }),
  );
}

export interface ParsedProgression {
  bars: Bar[];
  /** Tanınmayan akor yazımları. */
  errors: string[];
}

/**
 * Kullanıcının yazdığı diziyi ayrıştırır: ölçüler "|" ya da satır sonu ile, ölçü içindeki akorlar boşlukla ayrılır.
 * Örnek: "Am | F | C G | E7". "|" hiç yoksa her akor bir ölçüdür.
 */
export function parseProgressionText(text: string): ParsedProgression {
  const errors: string[] = [];
  const cleaned = text.replace(/[\r\n]+/g, ' | ').trim();
  if (!cleaned) return { bars: [], errors };
  const hasBars = cleaned.includes('|');
  const groups = hasBars
    ? cleaned.split('|').map((g) => g.trim().split(/\s+/).filter(Boolean))
    : cleaned.split(/\s+/).map((tok) => [tok]);
  const bars: Bar[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    const bar: Bar = [];
    for (const token of group.slice(0, 4)) {
      const p = parseChord(token);
      if (!p) {
        errors.push(token);
        continue;
      }
      bar.push({ root: p.root, quality: p.quality, symbol: chordSymbol(p.root, p.quality, COMMON_NAMES) });
    }
    if (bar.length > 0) bars.push(bar);
  }
  return { bars, errors };
}

const MINOR_QUALITIES: Quality[] = ['min', 'm7', 'm6', 'm7b5', 'dim', 'dim7'];

export function isMinorQuality(q: Quality): boolean {
  return MINOR_QUALITIES.includes(q);
}

/** Dizinin "ev" tonu: ilk akorun kökü ve türü. */
export function homeKey(bars: Bar[]): { root: number; mode: ProgMode } {
  const first = bars[0]?.[0];
  if (!first) return { root: 0, mode: 'major' };
  return { root: first.root, mode: isMinorQuality(first.quality) ? 'minor' : 'major' };
}

export function transposeBars(bars: Bar[], semitones: number, names: readonly string[] = COMMON_NAMES): Bar[] {
  return bars.map((bar) =>
    bar.map((c) => {
      const root = mod12(c.root + semitones);
      return { root, quality: c.quality, symbol: chordSymbol(root, c.quality, names) };
    }),
  );
}

/** Ölçünün verilen vuruşunda geçerli akor. */
export function chordAtBeat(bar: Bar, beat: number, beatsPerBar = 4): ProgChord {
  const index = Math.min(bar.length - 1, Math.floor((beat * bar.length) / beatsPerBar));
  return bar[index];
}

export interface ChordSpot {
  bar: number;
  /** Akorun başladığı vuruş. */
  beat: number;
  chord: ProgChord;
}

/** Dizideki akor değişim noktaları, sırayla. Ardışık aynı akorlar tek nokta sayılır (döngü dikkate alınmaz). */
export function chordSpots(bars: Bar[], beatsPerBar = 4): ChordSpot[] {
  const spots: ChordSpot[] = [];
  bars.forEach((bar, b) => {
    bar.forEach((chord, i) => {
      const beat = Math.floor((i * beatsPerBar) / bar.length);
      const prev = spots[spots.length - 1];
      if (!prev || prev.chord.symbol !== chord.symbol) spots.push({ bar: b, beat, chord });
    });
  });
  return spots;
}

/**
 * Verilen konumdan sonra gelecek ilk farklı akor.
 * @returns Dizi tek akorluysa ya da (döngü kapalıyken) sonuna gelindiyse null.
 */
export function nextChord(bars: Bar[], bar: number, beat: number, loop: boolean, beatsPerBar = 4): ProgChord | null {
  if (bars.length === 0) return null;
  const current = chordAtBeat(bars[bar % bars.length], beat, beatsPerBar);
  const total = bars.length * beatsPerBar;
  const start = (bar % bars.length) * beatsPerBar + beat;
  const limit = loop ? total : total - start - 1;
  for (let step = 1; step <= limit; step++) {
    const pos = (start + step) % total;
    const c = chordAtBeat(bars[Math.floor(pos / beatsPerBar)], pos % beatsPerBar, beatsPerBar);
    if (c.symbol !== current.symbol) return c;
  }
  return null;
}

/** Akoru klavye/pad için seslendirir: her akor notası merkeze en yakın oktavda. */
export function voiceChord(chord: ProgChord, center = 57): number[] {
  const intervals = QUALITIES[chord.quality].intervals.slice(0, 4);
  const notes = intervals.map((i) => {
    const pc = mod12(chord.root + i);
    let midi = center - 6 + mod12(pc - (center - 6));
    if (midi > center + 6) midi -= 12;
    return midi;
  });
  if (chord.quality === '5') notes.push(notes[0] + 12);
  return [...new Set(notes)].sort((a, b) => a - b);
}

/** Bas için kök nota: E1–D#2 aralığında. */
export function bassRoot(pc: number): number {
  return 28 + mod12(pc - 4);
}
