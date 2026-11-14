import type { Key } from '../../i18n';
import { centsBetween, freqToNote, midiName, midiOctave, midiToFreq } from '../../dsp/notes';

export interface Tuning {
  id: string;
  name: Key;
  /** Tellerin MIDI notaları, kalından inceye (6. tel → 1. tel). Kromatik için boş. */
  notes: number[];
}

export const TUNINGS: Tuning[] = [
  { id: 'standard', name: 'tuning.standard', notes: [40, 45, 50, 55, 59, 64] },
  { id: 'dropD', name: 'tuning.dropD', notes: [38, 45, 50, 55, 59, 64] },
  { id: 'halfDown', name: 'tuning.halfDown', notes: [39, 44, 49, 54, 58, 63] },
  { id: 'fullDown', name: 'tuning.fullDown', notes: [38, 43, 48, 53, 57, 62] },
  { id: 'dropC', name: 'tuning.dropC', notes: [36, 43, 48, 53, 57, 62] },
  { id: 'dadgad', name: 'tuning.dadgad', notes: [38, 45, 50, 55, 57, 62] },
  { id: 'openG', name: 'tuning.openG', notes: [38, 43, 50, 55, 59, 62] },
  { id: 'openD', name: 'tuning.openD', notes: [38, 45, 50, 54, 57, 62] },
  { id: 'openE', name: 'tuning.openE', notes: [40, 47, 52, 56, 59, 64] },
  { id: 'chromatic', name: 'tuning.chromatic', notes: [] },
];

export function getTuning(id: string): Tuning {
  return TUNINGS.find((t) => t.id === id) ?? TUNINGS[0];
}

/** Bir akort düzenindeki notaların kısa yazımı, ör. "E A D G B E". */
export function tuningLetters(tuning: Tuning): string {
  return tuning.notes.map((m) => midiName(m, tuning.id === 'halfDown')).join(' ');
}

export interface TunerReading {
  freq: number;
  /** Hedef nota (MIDI). */
  midi: number;
  name: string;
  octave: number;
  /** Hedefe göre sapma (cent). Kilitli telde ±50 dışına çıkabilir. */
  cents: number;
  /** Akort düzenindeki tel sırası (0 = en kalın); kromatik modda null. */
  stringIndex: number | null;
}

/** Bu aralıkta "akortlu" sayılır. */
export const IN_TUNE_CENTS = 4;

/**
 * Algılanan frekansı hedef notaya göre değerlendirir.
 * @param locked Kullanıcının kilitlediği tel; null ise en yakın tel/nota seçilir.
 */
export function evaluatePitch(freq: number, tuning: Tuning, a4: number, locked: number | null = null): TunerReading {
  const flats = tuning.id === 'halfDown';
  if (tuning.notes.length === 0) {
    const n = freqToNote(freq, a4);
    return { freq, midi: n.midi, name: n.name, octave: n.octave, cents: n.cents, stringIndex: null };
  }
  let index = locked !== null && locked >= 0 && locked < tuning.notes.length ? locked : -1;
  if (index < 0) {
    let best = Infinity;
    tuning.notes.forEach((midi, i) => {
      const d = Math.abs(centsBetween(freq, midiToFreq(midi, a4)));
      if (d < best) {
        best = d;
        index = i;
      }
    });
  }
  const midi = tuning.notes[index];
  return {
    freq,
    midi,
    name: midiName(midi, flats),
    octave: midiOctave(midi),
    cents: centsBetween(freq, midiToFreq(midi, a4)),
    stringIndex: index,
  };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface SmootherOptions {
  size?: number;
  minClarity?: number;
  minRms?: number;
  /** Sinyal kesilince son değerin kaç kare daha tutulacağı. */
  holdFrames?: number;
}

/**
 * Kare kare gelen perde ölçümlerini kararlı bir göstergeye çevirir:
 * medyan süzgeci, nota değişiminde sıfırlama ve kısa süreli tutma.
 */
export class PitchSmoother {
  private buf: number[] = [];
  private misses = 0;
  private readonly size: number;
  private readonly minClarity: number;
  private readonly minRms: number;
  private readonly holdFrames: number;

  constructor(opts: SmootherOptions = {}) {
    this.size = opts.size ?? 7;
    this.minClarity = opts.minClarity ?? 0.85;
    this.minRms = opts.minRms ?? 0.0015;
    this.holdFrames = opts.holdFrames ?? 14;
  }

  push(freq: number, clarity: number, rms: number): number | null {
    const valid = freq > 0 && clarity >= this.minClarity && rms >= this.minRms;
    if (!valid) {
      if (++this.misses > this.holdFrames) this.buf = [];
    } else {
      this.misses = 0;
      if (this.buf.length > 0 && Math.abs(centsBetween(freq, median(this.buf))) > 70) this.buf = [];
      this.buf.push(freq);
      if (this.buf.length > this.size) this.buf.shift();
    }
    // Tek karelik sıçramalar gösterilmez.
    return this.buf.length >= 2 ? median(this.buf) : null;
  }

  reset(): void {
    this.buf = [];
    this.misses = 0;
  }
}
