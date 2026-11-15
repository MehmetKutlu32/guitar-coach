import { STANDARD_TUNING } from './chords';

/** Tab (tablatura) veri modeli ve saf işlemleri. Izgara: 4/4'lük ölçü, ölçü başına 16 adım (on altılık). */

export const STEPS_PER_BAR = 16;
export const STEPS_PER_BEAT = 4;
export const STRINGS = 6;
export const EMPTY = -1;
/** Susturulmuş (ölü) nota: tabda "x". */
export const MUTED = -2;
export const MAX_FRET = 24;
export const MAX_BARS = 64;

export interface Tab {
  id: string;
  name: string;
  bpm: number;
  bars: number;
  /**
   * Adım başına 6 değer; dizin 0 = 6. tel (kalın Mi) … dizin 5 = 1. tel (ince Mi).
   * Değer: perde (0–24), EMPTY ya da MUTED.
   */
  notes: number[][];
  builtin?: boolean;
}

const emptyColumn = (): number[] => Array.from({ length: STRINGS }, () => EMPTY);

export function emptyTab(id: string, name: string, bars = 2, bpm = 90): Tab {
  return { id, name, bpm, bars, notes: Array.from({ length: bars * STEPS_PER_BAR }, emptyColumn) };
}

export function totalSteps(tab: Tab): number {
  return tab.bars * STEPS_PER_BAR;
}

/** Bir hücreyi değiştirir (yeni tab döndürür). Geçersiz konum ya da perde yok sayılır. */
export function setNote(tab: Tab, step: number, string: number, fret: number): Tab {
  if (step < 0 || step >= totalSteps(tab) || string < 0 || string >= STRINGS) return tab;
  if (fret !== EMPTY && fret !== MUTED && (fret < 0 || fret > MAX_FRET || !Number.isInteger(fret))) return tab;
  const notes = tab.notes.map((col, i) => (i === step ? col.map((v, s) => (s === string ? fret : v)) : col));
  return { ...tab, notes };
}

export function addBar(tab: Tab): Tab {
  if (tab.bars >= MAX_BARS) return tab;
  return { ...tab, bars: tab.bars + 1, notes: [...tab.notes, ...Array.from({ length: STEPS_PER_BAR }, emptyColumn)] };
}

/** Son ölçüyü siler (en az bir ölçü kalır). */
export function removeBar(tab: Tab): Tab {
  if (tab.bars <= 1) return tab;
  return { ...tab, bars: tab.bars - 1, notes: tab.notes.slice(0, (tab.bars - 1) * STEPS_PER_BAR) };
}

export interface TabNote {
  /** Tel dizini (0 = 6. tel). */
  string: number;
  midi: number;
  /** Notanın süresi, adım cinsinden: aynı teldeki sonraki notaya ya da aralığın sonuna kadar. */
  steps: number;
  muted: boolean;
}

/** En uzun nota süresi (adım): iki ölçü. Açık teller sonsuza dek çınlamasın. */
const MAX_NOTE_STEPS = 32;

/**
 * Verilen adımda başlayan notalar.
 * @param endStep Çalınan aralığın bittiği adım (hariç); nota bunun ötesine uzamaz.
 */
export function notesAt(tab: Tab, step: number, endStep = totalSteps(tab), tuning: number[] = STANDARD_TUNING): TabNote[] {
  const col = tab.notes[step];
  if (!col) return [];
  const out: TabNote[] = [];
  for (let s = 0; s < STRINGS; s++) {
    const fret = col[s];
    if (fret === EMPTY) continue;
    let steps = 1;
    while (step + steps < endStep && steps < MAX_NOTE_STEPS && tab.notes[step + steps][s] === EMPTY) steps++;
    const muted = fret === MUTED;
    out.push({ string: s, midi: tuning[s] + (muted ? 0 : fret), steps: muted ? 1 : steps, muted });
  }
  return out;
}

export interface PlayRange {
  /** İlk ölçü (0 tabanlı, dahil). */
  from: number;
  /** Son ölçü (0 tabanlı, dahil). */
  to: number;
  loop: boolean;
}

export function clampRange(tab: Tab, range: PlayRange): PlayRange {
  const from = Math.max(0, Math.min(tab.bars - 1, range.from));
  const to = Math.max(from, Math.min(tab.bars - 1, range.to));
  return { from, to, loop: range.loop };
}

/**
 * Çalmaya başlandığından beri geçen adım sayısını tab içindeki adıma çevirir.
 * @returns Çalma bittiyse (döngü kapalı ve aralığın sonu geçildi) -1.
 */
export function stepAt(elapsed: number, range: PlayRange): number {
  const length = (range.to - range.from + 1) * STEPS_PER_BAR;
  if (elapsed < 0) return -1;
  if (!range.loop && elapsed >= length) return -1;
  return range.from * STEPS_PER_BAR + (elapsed % length);
}

const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];

function cellText(fret: number): string {
  return fret === EMPTY ? '-' : fret === MUTED ? 'x' : String(fret);
}

/**
 * Tabı düz metin (ASCII) olarak yazar: üstte ince Mi teli, altta kalın Mi teli.
 * İki haneli perdeler sığsın diye her adım iki karakter genişliğindedir.
 */
export function toAscii(tab: Tab): string {
  const lines: string[] = [];
  for (let s = STRINGS - 1; s >= 0; s--) {
    let line = STRING_LABELS[s] + '|';
    for (let step = 0; step < totalSteps(tab); step++) {
      line += cellText(tab.notes[step][s]).padEnd(2, '-');
      if ((step + 1) % STEPS_PER_BAR === 0) line += '|';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Kısa yazım: [adım, tel numarası (6 = kalın Mi … 1 = ince Mi), perde]. */
export type NoteSpec = [step: number, stringNumber: number, fret: number];

export function buildTab(id: string, name: string, bpm: number, bars: number, specs: NoteSpec[], builtin = false): Tab {
  let tab = emptyTab(id, name, bars, bpm);
  for (const [step, stringNumber, fret] of specs) tab = setNote(tab, step, STRINGS - stringNumber, fret);
  return builtin ? { ...tab, builtin: true } : tab;
}

/** Tabdaki nota sayısı. */
export function noteCount(tab: Tab): number {
  let n = 0;
  for (const col of tab.notes) for (const v of col) if (v !== EMPTY) n++;
  return n;
}

export function isTab(v: unknown): v is Tab {
  if (!v || typeof v !== 'object') return false;
  const t = v as Partial<Tab>;
  return (
    typeof t.id === 'string' &&
    typeof t.name === 'string' &&
    typeof t.bpm === 'number' &&
    typeof t.bars === 'number' &&
    Number.isInteger(t.bars) &&
    t.bars >= 1 &&
    Array.isArray(t.notes) &&
    t.notes.length === t.bars * STEPS_PER_BAR &&
    t.notes.every((c) => Array.isArray(c) && c.length === STRINGS && c.every((x) => Number.isInteger(x) && x >= MUTED && x <= MAX_FRET))
  );
}

/** Tel dizini → ekranda gösterilen etiket (kalından inceye: E A D G B e). */
export function stringLabel(string: number): string {
  return STRING_LABELS[string];
}
