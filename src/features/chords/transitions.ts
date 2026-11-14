/** Akor geçiş egzersizi sonuçları için saf mantık. */

export interface TransitionResult {
  id: string;
  type: 'transition';
  /** Epoch ms. */
  date: number;
  a: string;
  b: string;
  /** Sıradan bağımsız çift anahtarı, ör. "Am|C". */
  pair: string;
  /** Süre içinde yapılan geçiş sayısı. */
  count: number;
  seconds: number;
  /** Sayım elle mi girildi, otomatik mi algılandı. */
  auto?: boolean;
  [key: string]: unknown;
}

export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

export function splitPair(key: string): [string, string] {
  const [a, b] = key.split('|');
  return [a, b ?? ''];
}

/** Farklı sürelerdeki sonuçları karşılaştırabilmek için dakika başına geçiş. */
export function perMinute(r: Pick<TransitionResult, 'count' | 'seconds'>): number {
  return r.seconds > 0 ? Math.round((r.count * 60) / r.seconds) : 0;
}

export interface PairSummary {
  pair: string;
  a: string;
  b: string;
  sessions: number;
  best: number;
  last: number;
  average: number;
  lastDate: number;
  /** Son sonuç ile ilk sonuç arasındaki fark (dakika başına). */
  improvement: number;
}

export function resultsForPair(results: TransitionResult[], pair: string): TransitionResult[] {
  return results.filter((r) => r.pair === pair).sort((x, y) => x.date - y.date);
}

/** Tüm çiftlerin özeti; en son çalışılan en üstte. */
export function summarizePairs(results: TransitionResult[]): PairSummary[] {
  const groups = new Map<string, TransitionResult[]>();
  for (const r of results) {
    const list = groups.get(r.pair);
    if (list) list.push(r);
    else groups.set(r.pair, [r]);
  }
  const out: PairSummary[] = [];
  for (const [pair, list] of groups) {
    list.sort((x, y) => x.date - y.date);
    const rates = list.map(perMinute);
    const [a, b] = splitPair(pair);
    out.push({
      pair,
      a,
      b,
      sessions: list.length,
      best: Math.max(...rates),
      last: rates[rates.length - 1],
      average: Math.round(rates.reduce((s, v) => s + v, 0) / rates.length),
      lastDate: list[list.length - 1].date,
      improvement: rates[rates.length - 1] - rates[0],
    });
  }
  return out.sort((x, y) => y.lastDate - x.lastDate);
}

/** Yeni sonucun, bu çiftteki önceki en iyi dereceyi geçip geçmediği. */
export function isNewBest(previous: TransitionResult[], candidate: Pick<TransitionResult, 'count' | 'seconds'>): boolean {
  if (previous.length === 0) return false;
  return perMinute(candidate) > Math.max(...previous.map(perMinute));
}

export function isTransitionResult(v: unknown): v is TransitionResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<TransitionResult>;
  return (
    r.type === 'transition' &&
    typeof r.id === 'string' &&
    typeof r.date === 'number' &&
    typeof r.a === 'string' &&
    typeof r.b === 'string' &&
    typeof r.pair === 'string' &&
    typeof r.count === 'number' &&
    typeof r.seconds === 'number'
  );
}
