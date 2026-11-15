/** Ritim geri bildirimi için saf hesaplar: vuruş–hedef eşleştirme, sapma istatistikleri, puanlar. */

export interface RhythmHit {
  /** Eşleşen hedefin sırası. */
  target: number;
  /** Sapma (ms): negatif = erken, pozitif = geç. */
  deviation: number;
}

export type Tendency = 'early' | 'late' | 'ontime';

export interface RhythmAnalysis {
  hits: RhythmHit[];
  /** Toplam hedef (çalınması beklenen vuruş) sayısı. */
  targets: number;
  missed: number;
  /** Hiçbir hedefle eşleşmeyen fazladan vuruşlar. */
  extra: number;
  /** Ortalama sapma (işaretli, ms). */
  meanMs: number;
  /** Ortalama mutlak sapma (ms). */
  absMs: number;
  /** Sapmaların standart sapması (ms): tutarlılık ölçüsü. */
  stdMs: number;
  /** ±20 ms içindeki vuruşların hedeflere oranı (0..1). */
  within20: number;
  /** 0–100: vuruşların hedeflere ne kadar yakın olduğu (kaçırılanlar 0 sayılır). */
  accuracy: number;
  /** 0–100: sapmaların birbirine ne kadar benzediği. */
  consistency: number;
  tendency: Tendency;
}

/** Bu sapmaya kadar vuruş "tam isabet" sayılır. */
export const PERFECT_MS = 10;
/** Bu sapmada vuruşun puanı sıfırlanır. */
export const ZERO_MS = 100;
export const GOOD_MS = 20;

/** Tek bir vuruşun puanı (0–100). */
export function hitScore(deviationMs: number): number {
  const d = Math.abs(deviationMs);
  if (d <= PERFECT_MS) return 100;
  if (d >= ZERO_MS) return 0;
  return (100 * (ZERO_MS - d)) / (ZERO_MS - PERFECT_MS);
}

/** Bir vuruşun hedefe eşlenebileceği en büyük uzaklık (saniye): hedef aralığının yarısından az, en çok 150 ms. */
export function matchWindow(targets: number[]): number {
  let minGap = Infinity;
  for (let i = 1; i < targets.length; i++) minGap = Math.min(minGap, targets[i] - targets[i - 1]);
  return Math.min(0.15, Number.isFinite(minGap) ? minGap * 0.45 : 0.15);
}

/**
 * Algılanan vuruşları hedef zamanlarla eşleştirir ve istatistikleri hesaplar.
 * @param targets Hedef zamanlar (saniye, artan).
 * @param onsets Algılanan vuruş zamanları (saniye).
 * @param latency Vuruş zamanlarından düşülecek toplam gecikme (saniye).
 */
export function analyzeRhythm(targets: number[], onsets: number[], latency = 0): RhythmAnalysis {
  const window = matchWindow(targets);
  const corrected = onsets.map((t) => t - latency);

  // En yakın çiftler önce eşleşir; her hedef ve her vuruş en çok bir kez kullanılır.
  const pairs: { t: number; o: number; d: number }[] = [];
  let from = 0;
  targets.forEach((target, t) => {
    while (from < corrected.length && corrected[from] < target - window) from++;
    for (let o = from; o < corrected.length && corrected[o] <= target + window; o++) {
      pairs.push({ t, o, d: corrected[o] - target });
    }
  });
  pairs.sort((a, b) => Math.abs(a.d) - Math.abs(b.d));
  const usedT = new Set<number>();
  const usedO = new Set<number>();
  const hits: RhythmHit[] = [];
  for (const p of pairs) {
    if (usedT.has(p.t) || usedO.has(p.o)) continue;
    usedT.add(p.t);
    usedO.add(p.o);
    hits.push({ target: p.t, deviation: p.d * 1000 });
  }
  hits.sort((a, b) => a.target - b.target);

  // Fazla vuruş: çalışma aralığında olup hiçbir hedefle eşleşmeyenler.
  let extra = 0;
  if (targets.length > 0) {
    const start = targets[0] - window;
    const end = targets[targets.length - 1] + window;
    corrected.forEach((t, o) => {
      if (!usedO.has(o) && t >= start && t <= end) extra++;
    });
  }

  const n = hits.length;
  const devs = hits.map((h) => h.deviation);
  const meanMs = n ? devs.reduce((s, d) => s + d, 0) / n : 0;
  const absMs = n ? devs.reduce((s, d) => s + Math.abs(d), 0) / n : 0;
  const stdMs = n > 1 ? Math.sqrt(devs.reduce((s, d) => s + (d - meanMs) ** 2, 0) / (n - 1)) : 0;
  const total = targets.length;
  const scoreSum = devs.reduce((s, d) => s + hitScore(d), 0);
  const accuracy = total ? Math.round(scoreSum / (total + 0.5 * extra)) : 0;
  const consistency = n >= 3 ? Math.round(100 * Math.max(0, 1 - stdMs / 40)) : 0;
  const within20 = total ? devs.filter((d) => Math.abs(d) <= GOOD_MS).length / total : 0;
  const tendency: Tendency = n < 3 ? 'ontime' : meanMs < -10 ? 'early' : meanMs > 10 ? 'late' : 'ontime';

  return {
    hits,
    targets: total,
    missed: total - n,
    extra,
    meanMs,
    absMs,
    stdMs,
    within20,
    accuracy,
    consistency,
    tendency,
  };
}

/**
 * Canlı gösterim için: tek bir vuruşun en yakın hedefe sapması (ms).
 * @returns Yakında hedef yoksa null.
 */
export function liveDeviation(targets: number[], onsetTime: number, latency: number, window: number): number | null {
  const t = onsetTime - latency;
  let best: number | null = null;
  // Hedefler artan sırada; sondan geriye bakmak yeterli (vuruşlar güncel hedeflerin yakınında).
  for (let i = targets.length - 1; i >= 0; i--) {
    const d = t - targets[i];
    if (best === null || Math.abs(d) < Math.abs(best)) best = d;
    if (d > window) break;
  }
  return best !== null && Math.abs(best) <= window ? best * 1000 : null;
}

export interface LatencyEstimate {
  latencyMs: number;
  /** Eşleşen tık sayısı. */
  matched: number;
  /** Ölçümlerin medyandan ortalama mutlak sapması (ms). Büyükse ölçüm güvenilmez. */
  spreadMs: number;
}

/**
 * Bilinen tık zamanları ile mikrofondan duyulan vuruşlardan toplam gecikmeyi kestirir.
 * @param before Tıktan en çok bu kadar önce gelen vuruşlar da eşleşir (çalarak ölçümde insan erken vurabilir).
 */
export function estimateLatency(clicks: number[], onsets: number[], before = 0.02, after = 0.45): LatencyEstimate | null {
  const diffs: number[] = [];
  for (const c of clicks) {
    const o = onsets.find((t) => t >= c - before && t <= c + after);
    if (o !== undefined) diffs.push((o - c) * 1000);
  }
  if (diffs.length < Math.max(4, Math.ceil(clicks.length * 0.6))) return null;
  const sorted = [...diffs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const spreadMs = diffs.reduce((s, d) => s + Math.abs(d - median), 0) / diffs.length;
  return { latencyMs: Math.max(0, Math.round(median)), matched: diffs.length, spreadMs };
}

export interface RhythmResult {
  id: string;
  type: 'rhythm';
  date: number;
  bpm: number;
  bars: number;
  /** Ne çalındığı: "div:2" (sekizlik) ya da "pattern:<ad>". */
  what: string;
  source: 'metronome' | 'backing';
  targets: number;
  hits: number;
  missed: number;
  extra: number;
  meanMs: number;
  absMs: number;
  stdMs: number;
  accuracy: number;
  consistency: number;
  /** Hedef sırasına göre sapmalar (ms); kaçırılan hedefler null. */
  deviations: (number | null)[];
  [key: string]: unknown;
}

export function toResult(
  a: RhythmAnalysis,
  meta: Pick<RhythmResult, 'id' | 'date' | 'bpm' | 'bars' | 'what' | 'source'>,
): RhythmResult {
  const deviations: (number | null)[] = Array.from({ length: a.targets }, () => null);
  for (const h of a.hits) deviations[h.target] = Math.round(h.deviation * 10) / 10;
  return {
    ...meta,
    type: 'rhythm',
    targets: a.targets,
    hits: a.hits.length,
    missed: a.missed,
    extra: a.extra,
    meanMs: Math.round(a.meanMs * 10) / 10,
    absMs: Math.round(a.absMs * 10) / 10,
    stdMs: Math.round(a.stdMs * 10) / 10,
    accuracy: a.accuracy,
    consistency: a.consistency,
    deviations,
  };
}

export function isRhythmResult(v: unknown): v is RhythmResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<RhythmResult>;
  return (
    r.type === 'rhythm' &&
    typeof r.id === 'string' &&
    typeof r.date === 'number' &&
    typeof r.accuracy === 'number' &&
    typeof r.consistency === 'number' &&
    Array.isArray(r.deviations)
  );
}
