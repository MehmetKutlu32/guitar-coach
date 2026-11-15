import { OPEN_CHORDS, STANDARD_TUNING } from './chords';
import { SCALES, type ScaleId } from './scales';
import { mod12, QUALITIES, type Quality } from './theory';

/** Sap (fretboard) üzerinde nota, gam, arpej ve CAGED konumları için saf hesaplar. */

export interface NeckDot {
  /** Tel dizini: 0 = 6. tel (kalın Mi) … 5 = 1. tel. */
  string: number;
  fret: number;
  /** Perde sınıfı (0 = C). */
  pc: number;
  /** Kökten yarım ton uzaklığı (0–11). */
  interval: number;
}

export function noteAt(string: number, fret: number, tuning: number[] = STANDARD_TUNING): number {
  return tuning[string] + fret;
}

/** Verilen aralıkları (kökten yarım ton) taşıyan tüm sap konumları. */
export function neckPositions(
  root: number,
  intervals: number[],
  fromFret: number,
  toFret: number,
  tuning: number[] = STANDARD_TUNING,
): NeckDot[] {
  const allowed = new Set(intervals.map(mod12));
  const out: NeckDot[] = [];
  for (let string = 0; string < tuning.length; string++) {
    for (let fret = fromFret; fret <= toFret; fret++) {
      const pc = mod12(tuning[string] + fret);
      const interval = mod12(pc - root);
      if (allowed.has(interval)) out.push({ string, fret, pc, interval });
    }
  }
  return out;
}

const GENERIC_DEGREES = ['1', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7'];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/**
 * Bir aralığın derece adı ("b3", "#4" …).
 * Yedi notalı gamlarda derece, majör gamın aynı sıradaki notasına göre adlandırılır (Lidyen'de "#4").
 */
export function degreeLabel(interval: number, scaleIntervals?: number[]): string {
  const iv = mod12(interval);
  if (scaleIntervals && scaleIntervals.length === 7) {
    const i = scaleIntervals.map(mod12).indexOf(iv);
    if (i >= 0) {
      const diff = iv - MAJOR[i];
      return (diff === -1 ? 'b' : diff === 1 ? '#' : diff === -2 ? 'bb' : '') + String(i + 1);
    }
  }
  return GENERIC_DEGREES[iv];
}

/** Akor türüne göre arpej dereceleri (artık akorda "#5", eksik yedilide "bb7"). */
export function arpeggioDegree(interval: number, quality: Quality): string {
  const iv = mod12(interval);
  if (quality === 'aug' && iv === 8) return '#5';
  if (quality === 'dim7' && iv === 9) return 'bb7';
  if ((quality === '6' || quality === 'm6') && iv === 9) return '6';
  if ((quality === 'add9' || quality === '9' || quality === 'sus2') && iv === 2) return quality === 'sus2' ? '2' : '9';
  return GENERIC_DEGREES[iv];
}

export const ARPEGGIO_QUALITIES: Quality[] = ['maj', 'min', '7', 'maj7', 'm7', 'm7b5', 'dim', 'dim7', 'aug', 'sus4', '6', '9'];

export function scaleDots(root: number, scale: ScaleId, fromFret: number, toFret: number): NeckDot[] {
  return neckPositions(root, SCALES[scale].intervals, fromFret, toFret);
}

export function arpeggioDots(root: number, quality: Quality, fromFret: number, toFret: number): NeckDot[] {
  return neckPositions(root, QUALITIES[quality].intervals, fromFret, toFret);
}

/** Gamın formülü: ardışık notalar arası yarım ton sayıları (son adım oktava döner). */
export function scaleSteps(scale: ScaleId): number[] {
  const iv = SCALES[scale].intervals;
  return iv.map((v, i) => (i + 1 < iv.length ? iv[i + 1] : 12) - v);
}

/** Bir modun ait olduğu majör gamın kökü (ör. Re Dorian → Do). Mod değilse null. */
export function parentMajorRoot(root: number, scale: ScaleId): number | null {
  const offset = SCALES[scale].parentMajor;
  if (SCALES[scale].intervals.length !== 7 || scale === 'major' || scale === 'harmonicMinor' || scale === 'melodicMinor') return null;
  return mod12(root + offset);
}

export type CagedShape = 'C' | 'A' | 'G' | 'E' | 'D';
export const CAGED_ORDER: CagedShape[] = ['C', 'A', 'G', 'E', 'D'];

export interface CagedPosition {
  shape: CagedShape;
  /** Biçimin akor notaları (taşınmış açık akor biçimi). */
  dots: NeckDot[];
  /** Biçimin kapladığı perde aralığı. */
  fromFret: number;
  toFret: number;
}

/**
 * CAGED: beş açık majör akor biçimi (C, A, G, E, D) sap boyunca taşınarak aynı akoru beş bölgede verir.
 * @returns Verilen kök için, biçimin sapta bulunduğu en alçak konum.
 */
export function cagedPosition(root: number, shape: CagedShape): CagedPosition {
  const open = OPEN_CHORDS.find((c) => c.symbol === shape)!;
  const shift = mod12(root - open.root);
  const dots: NeckDot[] = [];
  open.frets.forEach((f, string) => {
    if (f < 0) return;
    const fret = f + shift;
    const pc = mod12(STANDARD_TUNING[string] + fret);
    dots.push({ string, fret, pc, interval: mod12(pc - root) });
  });
  const frets = dots.map((d) => d.fret);
  return { shape, dots, fromFret: Math.min(...frets), toFret: Math.max(...frets) };
}

/** Bir kök için beş CAGED konumu, sapta alçaktan yükseğe sıralı. */
export function cagedPositions(root: number): CagedPosition[] {
  return CAGED_ORDER.map((s) => cagedPosition(root, s)).sort((a, b) => a.fromFret - b.fromFret || a.toFret - b.toFret);
}

// ---------- Nota ezberleme oyunu ----------

export type GameMode = 'name' | 'find';

export interface GameSettings {
  mode: GameMode;
  /** En yüksek perde (dahil). */
  maxFret: number;
  /** Yalnızca doğal notalar (diyez/bemol yok). */
  naturalsOnly: boolean;
  /** Oyuna dahil teller (dizin). */
  strings: number[];
}

export interface GameQuestion {
  string: number;
  fret: number;
  pc: number;
}

const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);

/** Ayarlara uyan tüm sorular. */
export function questionPool(settings: GameSettings): GameQuestion[] {
  const out: GameQuestion[] = [];
  for (const string of settings.strings) {
    // "Perdeyi bul" modunda açık tel sorulmaz (0 ve 12 aynı nota olurdu).
    for (let fret = settings.mode === 'find' ? 1 : 0; fret <= settings.maxFret; fret++) {
      const pc = mod12(STANDARD_TUNING[string] + fret);
      if (settings.naturalsOnly && !NATURAL.has(pc)) continue;
      out.push({ string, fret, pc });
    }
  }
  return out;
}

/**
 * Sıradaki soruyu seçer; bir önceki soruyu tekrarlamaz.
 * @param random 0 ≤ x < 1 üreten fonksiyon (testlerde tohumlu).
 */
export function nextQuestion(settings: GameSettings, previous: GameQuestion | null, random: () => number): GameQuestion {
  const pool = questionPool(settings).filter((q) => !previous || q.string !== previous.string || q.fret !== previous.fret);
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** "Nota adı" modunda yanıt seçenekleri (perde sınıfları). */
export function answerChoices(settings: GameSettings): number[] {
  return settings.naturalsOnly ? [0, 2, 4, 5, 7, 9, 11] : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
}

/** Yanıt doğru mu. `answer`: "name" modunda perde sınıfı, "find" modunda perde numarası. */
export function checkAnswer(mode: GameMode, question: GameQuestion, answer: number): boolean {
  if (mode === 'name') return mod12(answer) === question.pc;
  // Aynı telde 12 perde sonrası da aynı notadır.
  return mod12(STANDARD_TUNING[question.string] + answer) === question.pc;
}

export interface GameResult {
  id: string;
  type: 'fretgame';
  date: number;
  mode: GameMode;
  maxFret: number;
  naturalsOnly: boolean;
  correct: number;
  total: number;
  /** Tur süresi (saniye). */
  seconds: number;
  [key: string]: unknown;
}

/** Tur puanı: doğruluk yüzdesi. */
export function gameScore(correct: number, total: number): number {
  return total > 0 ? Math.round((100 * correct) / total) : 0;
}

export function isGameResult(v: unknown): v is GameResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<GameResult>;
  return (
    r.type === 'fretgame' &&
    typeof r.id === 'string' &&
    typeof r.date === 'number' &&
    typeof r.correct === 'number' &&
    typeof r.total === 'number' &&
    typeof r.seconds === 'number'
  );
}
