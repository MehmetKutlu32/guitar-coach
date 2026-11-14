export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export type NoteName = (typeof NOTE_NAMES)[number];

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Kesirli MIDI numarası. */
export function freqToMidi(freq: number, a4 = 440): number {
  return 69 + 12 * Math.log2(freq / a4);
}

export function centsBetween(freq: number, refFreq: number): number {
  return 1200 * Math.log2(freq / refFreq);
}

export function pitchClass(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function midiName(midi: number, flats = false): string {
  return (flats ? NOTE_NAMES_FLAT : NOTE_NAMES)[pitchClass(midi)];
}

export function midiOctave(midi: number): number {
  return Math.floor(Math.round(midi) / 12) - 1;
}

/** Örn. 40 -> "E2". */
export function midiLabel(midi: number, flats = false): string {
  return midiName(midi, flats) + midiOctave(midi);
}

export interface NoteReading {
  midi: number;
  name: string;
  octave: number;
  /** En yakın notadan sapma, -50..+50. */
  cents: number;
}

export function freqToNote(freq: number, a4 = 440): NoteReading {
  const exact = freqToMidi(freq, a4);
  const midi = Math.round(exact);
  return { midi, name: midiName(midi), octave: midiOctave(midi), cents: (exact - midi) * 100 };
}

/** "C#4", "Eb2" gibi bir etiketi MIDI numarasına çevirir. */
export function parseNote(label: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(label.trim());
  if (!m) throw new Error(`Invalid note: ${label}`);
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase() as 'C']!;
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return (parseInt(m[3], 10) + 1) * 12 + base + acc;
}
