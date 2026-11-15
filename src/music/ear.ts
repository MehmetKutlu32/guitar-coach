import { QUALITIES, type Quality } from './theory';

/** Kulak eğitimi: aralık ve akor türü tanıma için saf mantık (seviyeler, sorular, puan, ilerleme). */

export type EarKind = 'interval' | 'chord';
/** Aralıklarda notaların çalınış biçimi: çıkıcı, inici ya da aynı anda. */
export type EarDirection = 'up' | 'down' | 'together';

export interface EarLevel {
  /** Soru türleri: aralıkta yarım ton sayısı ("7"), akorda tür ("maj7"). */
  items: string[];
  directions: EarDirection[];
}

/** Bir turdaki soru sayısı. */
export const EAR_ROUND = 10;
/** Sonraki seviyeyi açan en düşük tur puanı (%). */
export const EAR_PASS = 80;

/**
 * Aralık seviyeleri: önce birbirinden çok farklı duyulanlar, sonra yakın olanlar;
 * son seviyelerde inici ve birlikte çalınan aralıklar.
 */
export const INTERVAL_LEVELS: EarLevel[] = [
  { items: ['4', '7', '12'], directions: ['up'] },
  { items: ['3', '4', '5', '7', '12'], directions: ['up'] },
  { items: ['1', '2', '3', '4', '5', '7', '12'], directions: ['up'] },
  { items: ['1', '2', '3', '4', '5', '7', '8', '9', '12'], directions: ['up', 'down'] },
  { items: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], directions: ['up', 'down'] },
  { items: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'], directions: ['up', 'down', 'together'] },
];

const CHORD_LEVEL_ITEMS: Quality[][] = [
  ['maj', 'min'],
  ['maj', 'min', '7'],
  ['maj', 'min', '7', 'maj7', 'm7'],
  ['maj', 'min', '7', 'maj7', 'm7', 'sus2', 'sus4'],
  ['maj', 'min', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim', 'aug'],
  ['maj', 'min', '7', 'maj7', 'm7', 'sus2', 'sus4', 'dim', 'aug', 'm7b5', 'dim7'],
];

export const CHORD_LEVELS: EarLevel[] = CHORD_LEVEL_ITEMS.map((items) => ({ items, directions: ['together'] }));

export function earLevels(kind: EarKind): EarLevel[] {
  return kind === 'interval' ? INTERVAL_LEVELS : CHORD_LEVELS;
}

export interface EarQuestion {
  kind: EarKind;
  /** Doğru yanıt (seviyedeki `items` değerlerinden biri). */
  item: string;
  /** İlk çalınan (aralık) ya da kök (akor) notanın MIDI numarası. */
  rootMidi: number;
  direction: EarDirection;
}

/** Gitarın rahat duyulan bölgesi: açık 6. tel (E2) – 1. telin 12. perdesi (E5). */
const LOW = 40;
const HIGH = 76;

/** Bir sorunun yanıtına karşılık gelen yarım ton aralıkları (kökten). */
export function itemIntervals(kind: EarKind, item: string): number[] {
  if (kind === 'interval') return [0, Number(item)];
  return QUALITIES[item as Quality].intervals;
}

export interface EarNote {
  midi: number;
  /** Sorunun başından itibaren saniye. */
  at: number;
}

/** Aralıkta iki nota arası süre (saniye). */
export const INTERVAL_GAP = 0.7;

/** Sorunun çalınacak notaları. `item` verilirse aynı kökten o yanıt çalınır (yanlış yanıtı dinlemek için). */
export function questionNotes(q: EarQuestion, item: string = q.item): EarNote[] {
  if (q.kind === 'chord') return itemIntervals('chord', item).map((i) => ({ midi: q.rootMidi + i, at: 0 }));
  const n = Number(item);
  if (q.direction === 'together') return [{ midi: q.rootMidi, at: 0 }, { midi: q.rootMidi + n, at: 0 }];
  const second = q.direction === 'up' ? q.rootMidi + n : q.rootMidi - n;
  return [{ midi: q.rootMidi, at: 0 }, { midi: second, at: INTERVAL_GAP }];
}

/** Sorunun tüm notaları gitar aralığında kalacak biçimde seçilebilecek kökler. */
export function rootRange(kind: EarKind, direction: EarDirection): [number, number] {
  // Akorlar orta-pes bölgede (A2–A3) en anlaşılır duyulur; aralıklar bir oktav genişliğe sığmalı.
  if (kind === 'chord') return [45, 57];
  return direction === 'down' ? [LOW + 12, HIGH - 4] : [LOW + 5, HIGH - 12];
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Bir turun sorularını üretir. Seviyedeki türler dengeli dağıtılır (her tür en az ⌊n / tür sayısı⌋ kez),
 * art arda iki soru aynı kökten başlamaz.
 * @param random 0 ≤ x < 1 üreten fonksiyon (testlerde tohumlu).
 */
export function makeRound(kind: EarKind, level: number, random: () => number, n: number = EAR_ROUND): EarQuestion[] {
  const levels = earLevels(kind);
  const def = levels[Math.max(1, Math.min(levels.length, level)) - 1];
  let bag: string[] = [];
  while (bag.length + def.items.length <= n) bag = bag.concat(def.items);
  bag = bag.concat(shuffle(def.items, random).slice(0, n - bag.length));
  const items = shuffle(bag, random);
  const out: EarQuestion[] = [];
  for (const item of items) {
    const direction = def.directions[Math.min(def.directions.length - 1, Math.floor(random() * def.directions.length))];
    const [lo, hi] = rootRange(kind, direction);
    let rootMidi = lo + Math.min(hi - lo, Math.floor(random() * (hi - lo + 1)));
    const prev = out[out.length - 1];
    if (prev && prev.rootMidi === rootMidi) rootMidi = rootMidi + 1 > hi ? lo : rootMidi + 1;
    out.push({ kind, item, rootMidi, direction });
  }
  return out;
}

/** Soru türü başına [sorulan, doğru]. */
export type EarTally = Record<string, [number, number]>;

export interface EarResult {
  id: string;
  type: 'ear';
  date: number;
  kind: EarKind;
  level: number;
  correct: number;
  total: number;
  /** Tur süresi (saniye). */
  seconds: number;
  items: EarTally;
  [key: string]: unknown;
}

export function isEarResult(v: unknown): v is EarResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<EarResult>;
  return (
    r.type === 'ear' &&
    typeof r.id === 'string' &&
    typeof r.date === 'number' &&
    (r.kind === 'interval' || r.kind === 'chord') &&
    typeof r.level === 'number' &&
    typeof r.correct === 'number' &&
    typeof r.total === 'number' &&
    typeof r.seconds === 'number' &&
    !!r.items &&
    typeof r.items === 'object'
  );
}

export function earScore(correct: number, total: number): number {
  return total > 0 ? Math.round((100 * correct) / total) : 0;
}

/** Tur, sonraki seviyeyi açmaya yeter mi (yarıda bırakılan turlar sayılmaz). */
export function isPass(r: Pick<EarResult, 'correct' | 'total'>): boolean {
  return r.total >= EAR_ROUND && earScore(r.correct, r.total) >= EAR_PASS;
}

/** Açık olan en yüksek seviye: 1. seviye hep açıktır; her seviye bir önceki geçilince açılır. */
export function unlockedLevel(results: EarResult[], kind: EarKind): number {
  const max = earLevels(kind).length;
  const passed = new Set(results.filter((r) => r.kind === kind && isPass(r)).map((r) => r.level));
  let level = 1;
  while (level < max && passed.has(level)) level++;
  return level;
}

export function tally(tallyMap: EarTally, item: string, ok: boolean): EarTally {
  const [asked, correct] = tallyMap[item] ?? [0, 0];
  return { ...tallyMap, [item]: [asked + 1, correct + (ok ? 1 : 0)] };
}

export interface ItemAccuracy {
  item: string;
  asked: number;
  correct: number;
  /** Doğruluk yüzdesi. */
  percent: number;
}

/** Bir türdeki tüm turlardan soru türü başına doğruluk; en zayıf olan başta. */
export function itemAccuracy(results: EarResult[], kind: EarKind): ItemAccuracy[] {
  const sum: EarTally = {};
  for (const r of results) {
    if (r.kind !== kind) continue;
    for (const [item, pair] of Object.entries(r.items)) {
      if (!Array.isArray(pair)) continue;
      const cur = sum[item] ?? [0, 0];
      sum[item] = [cur[0] + (Number(pair[0]) || 0), cur[1] + (Number(pair[1]) || 0)];
    }
  }
  return Object.entries(sum)
    .filter(([, [asked]]) => asked > 0)
    .map(([item, [asked, correct]]) => ({ item, asked, correct, percent: earScore(correct, asked) }))
    .sort((a, b) => a.percent - b.percent || b.asked - a.asked || a.item.localeCompare(b.item, 'en', { numeric: true }));
}
