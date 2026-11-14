import type { Key } from '../../i18n';
import { bassRoot, chordAtBeat, isMinorQuality, voiceChord, type Bar, type ProgChord } from '../../music/progressions';

/** Vuruş başına adım: hem on altılıkları (3'er) hem üçlemeleri (4'er) taşır. */
export const TICKS_PER_BEAT = 12;
export const BEATS_PER_BAR = 4;
export const BAR_TICKS = TICKS_PER_BEAT * BEATS_PER_BAR;

export type StyleId = 'rock' | 'blues' | 'pop' | 'funk';
export type BassDegree = 'R' | '3' | '5' | '6' | '7' | '8';

interface BassHit {
  tick: number;
  degree: BassDegree;
  /** Vuruş cinsinden uzunluk. */
  beats: number;
}

interface ChordHit {
  tick: number;
  beats: number;
}

export interface StyleDef {
  id: StyleId;
  name: Key;
  kick: number[];
  snare: number[];
  /** Hafif (hayalet) trampet vuruşları. */
  ghost: number[];
  hat: number[];
  /** Dizinin son ölçüsünün son vuruşundaki geçiş (trampet). */
  fill: number[];
  bass: BassHit[];
  chord: ChordHit[];
}

const every = (step: number) => Array.from({ length: BAR_TICKS / step }, (_, i) => i * step);
const swung = [0, 8, 12, 20, 24, 32, 36, 44];

export const STYLES: Record<StyleId, StyleDef> = {
  rock: {
    id: 'rock',
    name: 'style.rock',
    kick: [0, 18, 24],
    snare: [12, 36],
    ghost: [],
    hat: every(6),
    fill: [36, 39, 42, 45],
    bass: every(6).map((tick) => ({ tick, degree: 'R' as BassDegree, beats: 0.45 })),
    chord: [
      { tick: 0, beats: 1.9 },
      { tick: 24, beats: 1.9 },
    ],
  },
  blues: {
    id: 'blues',
    name: 'style.blues',
    kick: [0, 24],
    snare: [12, 36],
    ghost: [],
    hat: swung,
    fill: [36, 40, 44],
    bass: (['R', '3', '5', '6'] as BassDegree[]).flatMap((degree, beat) => [
      { tick: beat * 12, degree, beats: 0.6 },
      { tick: beat * 12 + 8, degree, beats: 0.3 },
    ]),
    chord: [
      { tick: 0, beats: 0.5 },
      { tick: 20, beats: 0.3 },
      { tick: 24, beats: 0.5 },
      { tick: 44, beats: 0.3 },
    ],
  },
  pop: {
    id: 'pop',
    name: 'style.pop',
    kick: [0, 18, 24],
    snare: [12, 36],
    ghost: [],
    hat: every(6),
    fill: [36, 42],
    bass: [
      { tick: 0, degree: 'R', beats: 1.4 },
      { tick: 18, degree: 'R', beats: 0.45 },
      { tick: 24, degree: '5', beats: 0.9 },
      { tick: 36, degree: 'R', beats: 0.9 },
    ],
    chord: [{ tick: 0, beats: 3.9 }],
  },
  funk: {
    id: 'funk',
    name: 'style.funk',
    kick: [0, 9, 30],
    snare: [12, 36],
    ghost: [21, 45],
    hat: every(3),
    fill: [36, 39, 42, 45],
    bass: [
      { tick: 0, degree: 'R', beats: 0.4 },
      { tick: 9, degree: '8', beats: 0.2 },
      { tick: 18, degree: 'R', beats: 0.4 },
      { tick: 30, degree: 'R', beats: 0.2 },
      { tick: 33, degree: '8', beats: 0.2 },
      { tick: 42, degree: '7', beats: 0.4 },
    ],
    chord: [
      { tick: 0, beats: 0.2 },
      { tick: 9, beats: 0.2 },
      { tick: 18, beats: 0.2 },
      { tick: 30, beats: 0.2 },
      { tick: 42, beats: 0.2 },
    ],
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];

/** Bas derecesini akora göre MIDI notasına çevirir. */
export function bassNote(chord: ProgChord, degree: BassDegree): number {
  const root = bassRoot(chord.root);
  const minor = isMinorQuality(chord.quality);
  switch (degree) {
    case 'R':
      return root;
    case '8':
      return root + 12;
    case '3':
      return root + (minor ? 3 : chord.quality === 'sus4' ? 5 : chord.quality === 'sus2' ? 2 : 4);
    case '5':
      return root + (chord.quality === 'dim' || chord.quality === 'm7b5' || chord.quality === 'dim7' ? 6 : 7);
    case '6':
      // Minör akorlarda altılı yerine küçük yedili daha doğal durur.
      return root + (minor ? 10 : 9);
    case '7':
      return root + (chord.quality === 'maj7' ? 11 : 10);
  }
}

export type BandEvent =
  | { kind: 'kick' | 'snare' | 'hat' | 'crash'; velocity: number }
  | { kind: 'bass'; midi: number; beats: number; velocity: number }
  | { kind: 'chord'; midis: number[]; beats: number; velocity: number };

/**
 * Bir ölçünün verilen adımında çalınacak sesler (saf; ses üretmez).
 * @param barIndex Dizi içindeki ölçü (0 tabanlı).
 */
export function eventsAt(bars: Bar[], style: StyleId, barIndex: number, tick: number): BandEvent[] {
  const def = STYLES[style];
  const bar = bars[barIndex];
  const out: BandEvent[] = [];
  if (!bar) return out;
  const beat = Math.floor(tick / TICKS_PER_BEAT);
  const chord = chordAtBeat(bar, beat, BEATS_PER_BAR);
  const isLast = barIndex === bars.length - 1 && bars.length > 1;
  const inFill = isLast && tick >= 36;

  if (tick === 0 && barIndex === 0) out.push({ kind: 'crash', velocity: 0.7 });
  if (def.kick.includes(tick)) out.push({ kind: 'kick', velocity: tick === 0 ? 1 : 0.85 });
  if (inFill) {
    if (def.fill.includes(tick)) out.push({ kind: 'snare', velocity: 0.6 + 0.4 * ((tick - 36) / 12) });
  } else {
    if (def.snare.includes(tick)) out.push({ kind: 'snare', velocity: 0.95 });
    if (def.ghost.includes(tick)) out.push({ kind: 'snare', velocity: 0.3 });
  }
  if (def.hat.includes(tick)) out.push({ kind: 'hat', velocity: tick % TICKS_PER_BEAT === 0 ? 0.8 : 0.5 });

  for (const hit of def.bass) {
    if (hit.tick === tick) out.push({ kind: 'bass', midi: bassNote(chord, hit.degree), beats: hit.beats, velocity: 0.9 });
  }
  // Ölçü içinde akor değişiyorsa değişim anında da akor duyulsun.
  const prevChord = beat > 0 ? chordAtBeat(bar, beat - 1, BEATS_PER_BAR) : null;
  const changeHere = tick % TICKS_PER_BEAT === 0 && prevChord !== null && prevChord.symbol !== chord.symbol;
  const hit = def.chord.find((h) => h.tick === tick);
  if (hit || changeHere) {
    // Akor, ölçü içindeki bir sonraki akorun üstüne taşmasın.
    const index = Math.min(bar.length - 1, Math.floor((beat * bar.length) / BEATS_PER_BAR));
    const endBeat = Math.ceil(((index + 1) * BEATS_PER_BAR) / bar.length);
    const room = endBeat - tick / TICKS_PER_BEAT - 0.05;
    out.push({ kind: 'chord', midis: voiceChord(chord), beats: Math.min(hit?.beats ?? 0.9, room), velocity: 0.8 });
  }
  return out;
}
