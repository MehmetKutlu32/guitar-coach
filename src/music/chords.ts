import { chordSymbol, mod12, type Quality } from './theory';

export type ChordCategory = 'open' | 'barre' | 'power';

export interface ChordShape {
  id: string;
  /** Akor simgesi, ör. "Am". */
  symbol: string;
  root: number;
  quality: Quality;
  category: ChordCategory;
  /** Kalın telden inceye (6. → 1. tel): perde numarası, 0 = açık tel, -1 = çalınmaz. */
  frets: number[];
  /** Parmaklar: 0 = yok, 1 = işaret … 4 = serçe. */
  fingers: number[];
  /** Kök notanın bulunduğu tel (6 ya da 5); taşınabilir biçimlerde. */
  rootString?: 6 | 5;
}

/** Standart akort: E2 A2 D3 G3 B3 E4. */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

type Row = [symbol: string, root: number, quality: Quality, frets: string, fingers: string];

const parseFrets = (s: string) => s.split('').map((c) => (c === 'x' ? -1 : parseInt(c, 16)));
const parseFingers = (s: string) => s.split('').map((c) => parseInt(c, 10));

const OPEN: Row[] = [
  ['C', 0, 'maj', 'x32010', '032010'],
  ['D', 2, 'maj', 'xx0232', '000132'],
  ['E', 4, 'maj', '022100', '023100'],
  ['G', 7, 'maj', '320003', '210003'],
  ['A', 9, 'maj', 'x02220', '001230'],
  ['F', 5, 'maj', 'xx3211', '003211'],
  ['Am', 9, 'min', 'x02210', '002310'],
  ['Em', 4, 'min', '022000', '023000'],
  ['Dm', 2, 'min', 'xx0231', '000231'],
  ['A7', 9, '7', 'x02020', '002030'],
  ['B7', 11, '7', 'x21202', '021304'],
  ['C7', 0, '7', 'x32310', '032410'],
  ['D7', 2, '7', 'xx0212', '000213'],
  ['E7', 4, '7', '020100', '020100'],
  ['G7', 7, '7', '320001', '320001'],
  ['Am7', 9, 'm7', 'x02010', '002010'],
  ['Em7', 4, 'm7', '020000', '020000'],
  ['Dm7', 2, 'm7', 'xx0211', '000211'],
  ['Cmaj7', 0, 'maj7', 'x32000', '032000'],
  ['Fmaj7', 5, 'maj7', 'xx3210', '003210'],
  ['Amaj7', 9, 'maj7', 'x02120', '002130'],
  ['Dmaj7', 2, 'maj7', 'xx0222', '000111'],
  ['Gmaj7', 7, 'maj7', '320002', '320001'],
  ['Asus2', 9, 'sus2', 'x02200', '001200'],
  ['Asus4', 9, 'sus4', 'x02230', '001230'],
  ['Dsus2', 2, 'sus2', 'xx0230', '000130'],
  ['Dsus4', 2, 'sus4', 'xx0233', '000134'],
  ['Esus4', 4, 'sus4', '022200', '023400'],
  ['Cadd9', 0, 'add9', 'x32030', '021030'],
];

export const OPEN_CHORDS: ChordShape[] = OPEN.map(([symbol, root, quality, frets, fingers]) => ({
  id: `open:${symbol}`,
  symbol,
  root,
  quality,
  category: 'open',
  frets: parseFrets(frets),
  fingers: parseFingers(fingers),
}));

interface Movable {
  quality: Quality;
  rootString: 6 | 5;
  /** Kök perdeye göre bağıl perdeler; null = çalınmaz. */
  offsets: (number | null)[];
  fingers: number[];
}

const BARRE_FORMS: Movable[] = [
  { quality: 'maj', rootString: 6, offsets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1] },
  { quality: 'min', rootString: 6, offsets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1] },
  { quality: '7', rootString: 6, offsets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1] },
  { quality: 'm7', rootString: 6, offsets: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1] },
  { quality: 'maj', rootString: 5, offsets: [null, 0, 2, 2, 2, 0], fingers: [0, 1, 2, 3, 4, 1] },
  { quality: 'min', rootString: 5, offsets: [null, 0, 2, 2, 1, 0], fingers: [0, 1, 3, 4, 2, 1] },
  { quality: '7', rootString: 5, offsets: [null, 0, 2, 0, 2, 0], fingers: [0, 1, 3, 1, 4, 1] },
  { quality: 'm7', rootString: 5, offsets: [null, 0, 2, 0, 1, 0], fingers: [0, 1, 3, 1, 2, 1] },
  { quality: 'maj7', rootString: 5, offsets: [null, 0, 2, 1, 2, 0], fingers: [0, 1, 3, 2, 4, 1] },
];

const POWER_FORMS: Movable[] = [
  { quality: '5', rootString: 6, offsets: [0, 2, 2, null, null, null], fingers: [1, 3, 4, 0, 0, 0] },
  { quality: '5', rootString: 5, offsets: [null, 0, 2, 2, null, null], fingers: [0, 1, 3, 4, 0, 0] },
];

function movable(form: Movable, fret: number, category: ChordCategory): ChordShape {
  const openRoot = form.rootString === 6 ? 4 : 9; // E ya da A
  const root = mod12(openRoot + fret);
  const frets = form.offsets.map((o) => (o === null ? -1 : o + fret));
  // Açık konumda (perde 0) işaret parmağı basmaz; diğer parmaklar bir kayar.
  const fingers =
    fret === 0 ? form.fingers.map((f, i) => (frets[i] <= 0 ? 0 : Math.max(1, f - 2))) : [...form.fingers];
  const symbol = chordSymbol(root, form.quality);
  return {
    id: `${category}${form.rootString}:${symbol}`,
    symbol,
    root,
    quality: form.quality,
    category,
    frets,
    fingers,
    rootString: form.rootString,
  };
}

/** Bare akorlar: E ve A biçimleri, 1.–11. perdeler (12 kökün tamamı). */
export const BARRE_CHORDS: ChordShape[] = BARRE_FORMS.flatMap((form) =>
  Array.from({ length: 11 }, (_, i) => movable(form, i + 1, 'barre')),
);

/** Power akorlar (kök + beşli): kök 6. ya da 5. telde, 0.–11. perdeler. */
export const POWER_CHORDS: ChordShape[] = POWER_FORMS.flatMap((form) =>
  Array.from({ length: 12 }, (_, i) => movable(form, i, 'power')),
);

export const ALL_CHORDS: ChordShape[] = [...OPEN_CHORDS, ...BARRE_CHORDS, ...POWER_CHORDS];

const lowestFret = (s: ChordShape) => Math.min(...s.frets.filter((f) => f > 0), 99);

/** Bir simge için önerilen biçim: varsa açık akor, yoksa en alçak perdedeki biçim. */
const PRIMARY = new Map<string, ChordShape>();
for (const shape of [
  ...OPEN_CHORDS,
  ...[...BARRE_CHORDS].sort((a, b) => lowestFret(a) - lowestFret(b)),
  ...[...POWER_CHORDS].sort((a, b) => lowestFret(a) - lowestFret(b)),
]) {
  if (!PRIMARY.has(shape.symbol)) PRIMARY.set(shape.symbol, shape);
}

export function primaryShape(symbol: string): ChordShape | undefined {
  return PRIMARY.get(symbol);
}

/** Seçim listeleri için: her simge bir kez, kategoriye göre. */
export function chordSymbols(category: ChordCategory): string[] {
  return [...PRIMARY.values()].filter((s) => s.category === category).map((s) => s.symbol);
}

export function chordsFor(category: ChordCategory, root?: number): ChordShape[] {
  const list = category === 'open' ? OPEN_CHORDS : category === 'barre' ? BARRE_CHORDS : POWER_CHORDS;
  if (root === undefined || category === 'open') return list;
  return list.filter((s) => s.root === root).sort((a, b) => lowestFret(a) - lowestFret(b));
}

/** Biçimin çaldığı notalar (MIDI), kalın telden inceye; çalınmayan teller atlanır. */
export function shapeNotes(shape: ChordShape, tuning: number[] = STANDARD_TUNING): number[] {
  const out: number[] = [];
  shape.frets.forEach((f, i) => {
    if (f >= 0) out.push(tuning[i] + f);
  });
  return out;
}

export interface DiagramLayout {
  /** Diyagramın ilk satırındaki perde numarası. */
  baseFret: number;
  rows: number;
  barre: { fret: number; from: number; to: number } | null;
}

export function diagramLayout(shape: ChordShape): DiagramLayout {
  const fretted = shape.frets.filter((f) => f > 0);
  const maxFret = fretted.length ? Math.max(...fretted) : 0;
  const minFret = fretted.length ? Math.min(...fretted) : 1;
  const baseFret = maxFret <= 4 ? 1 : minFret;
  const rows = Math.max(4, maxFret - baseFret + 1);
  // Bare: işaret parmağı aynı perdede birden çok tele basıyorsa.
  const idx = shape.fingers.map((f, i) => (f === 1 ? i : -1)).filter((i) => i >= 0);
  let barre: DiagramLayout['barre'] = null;
  if (idx.length >= 2) {
    const fret = shape.frets[idx[0]];
    if (fret > 0 && idx.every((i) => shape.frets[i] === fret)) {
      barre = { fret, from: idx[0], to: idx[idx.length - 1] };
    }
  }
  return { baseFret, rows, barre };
}
