import { describe, expect, it } from 'vitest';
import {
  analyzeRhythm,
  estimateLatency,
  hitScore,
  isRhythmResult,
  liveDeviation,
  matchWindow,
  toResult,
} from '../../src/features/rhythm/analysis';

/** 120 BPM dörtlükler: 0,5 sn aralıklı hedefler. */
const grid = (n: number, step = 0.5, start = 10) => Array.from({ length: n }, (_, i) => start + i * step);
const ms = (v: number) => v / 1000;

describe('vuruş–hedef eşleştirme ve sapma ölçümü', () => {
  it('bilinen sapmaları milisaniyesi milisaniyesine geri verir', () => {
    const targets = grid(8);
    const offsets = [12, -18, 30, 0, -8, 22, -25, 5];
    const onsets = targets.map((t, i) => t + ms(offsets[i]));
    const a = analyzeRhythm(targets, onsets);
    expect(a.hits.map((h) => Math.round(h.deviation))).toEqual(offsets);
    expect(a.missed).toBe(0);
    expect(a.extra).toBe(0);
    expect(a.meanMs).toBeCloseTo(2.25, 6);
    expect(a.absMs).toBeCloseTo(15, 6);
    expect(a.targets).toBe(8);
  });

  it('gecikme düzeltmesi vuruş zamanlarından düşülür', () => {
    const targets = grid(6);
    const onsets = targets.map((t) => t + 0.137 + ms(-10));
    const a = analyzeRhythm(targets, onsets, 0.137);
    for (const h of a.hits) expect(h.deviation).toBeCloseTo(-10, 6);
    // Düzeltme olmadan aynı vuruşlar 127 ms geç görünür.
    expect(analyzeRhythm(targets, onsets).meanMs).toBeCloseTo(127, 6);
  });

  it('kaçırılan hedefler ve fazladan vuruşlar ayrı sayılır', () => {
    const targets = grid(8);
    const onsets = targets.filter((_, i) => i !== 3).map((t) => t + ms(5));
    // İki hedefin tam ortasında fazladan bir vuruş.
    onsets.push(targets[5] + 0.25);
    onsets.sort((x, y) => x - y);
    const a = analyzeRhythm(targets, onsets);
    expect(a.hits).toHaveLength(7);
    expect(a.missed).toBe(1);
    expect(a.extra).toBe(1);
    expect(a.hits.some((h) => h.target === 3)).toBe(false);
  });

  it('bir hedefe en yakın vuruş eşlenir; çift vuruşun ikincisi fazla sayılır', () => {
    const targets = grid(4);
    const onsets = [targets[0] + ms(40), targets[0] + ms(-6), targets[1], targets[2], targets[3]];
    onsets.sort((x, y) => x - y);
    const a = analyzeRhythm(targets, onsets);
    expect(Math.round(a.hits[0].deviation)).toBe(-6);
    expect(a.extra).toBe(1);
    expect(a.missed).toBe(0);
  });

  it('eşleşme penceresi hedef aralığıyla daralır', () => {
    expect(matchWindow(grid(4, 0.5))).toBeCloseTo(0.15, 6);
    // 160 BPM on altılıklar: 93,75 ms aralık → pencere ≈ 42 ms.
    expect(matchWindow(grid(4, 60 / 160 / 4))).toBeCloseTo(0.0421875, 6);
    expect(matchWindow([1])).toBe(0.15);
    // Pencere dışındaki vuruş eşleşmez.
    const fast = grid(8, 0.1);
    const a = analyzeRhythm(fast, [fast[2] + 0.049]);
    expect(a.hits).toHaveLength(0);
    expect(a.extra).toBe(1);
  });

  it('çalışma aralığı dışındaki vuruşlar (sayma ölçüsü, bitişten sonrası) yok sayılır', () => {
    const targets = grid(4);
    const a = analyzeRhythm(targets, [targets[0] - 2, targets[0] - 1, ...targets, targets[3] + 3]);
    expect(a.extra).toBe(0);
    expect(a.hits).toHaveLength(4);
  });

  it('hiç vuruş ya da hiç hedef yokken çökmez', () => {
    const none = analyzeRhythm(grid(4), []);
    expect(none).toMatchObject({ missed: 4, extra: 0, accuracy: 0, consistency: 0, meanMs: 0, tendency: 'ontime' });
    expect(analyzeRhythm([], [1, 2]).targets).toBe(0);
  });
});

describe('puanlar', () => {
  it('vuruş puanı: 10 ms içinde tam, 100 ms ve ötesinde sıfır', () => {
    expect(hitScore(0)).toBe(100);
    expect(hitScore(-10)).toBe(100);
    expect(hitScore(55)).toBeCloseTo(50, 6);
    expect(hitScore(-100)).toBe(0);
    expect(hitScore(250)).toBe(0);
  });

  it('isabet: kusursuz çalış 100; kaçırılan ve fazla vuruş puanı düşürür', () => {
    const targets = grid(8);
    expect(analyzeRhythm(targets, targets).accuracy).toBe(100);
    expect(analyzeRhythm(targets, targets.slice(0, 4)).accuracy).toBe(50);
    const withExtras = [...targets, targets[0] + 0.25, targets[1] + 0.25].sort((x, y) => x - y);
    expect(analyzeRhythm(targets, withExtras).accuracy).toBe(Math.round(800 / 9));
  });

  it('tutarlılık sapmaların yayılımına bakar, ortalamasına değil', () => {
    const targets = grid(12);
    // Hep 30 ms geç: isabet düşer ama tutarlılık tam.
    const steady = analyzeRhythm(targets, targets.map((t) => t + ms(30)));
    expect(steady.consistency).toBe(100);
    expect(steady.accuracy).toBeLessThan(100);
    expect(steady.tendency).toBe('late');
    // Ortalaması sıfır ama dağınık.
    const loose = analyzeRhythm(targets, targets.map((t, i) => t + ms(i % 2 ? 35 : -35)));
    expect(Math.abs(loose.meanMs)).toBeLessThan(1e-6);
    expect(loose.consistency).toBeLessThan(15);
    expect(loose.tendency).toBe('ontime');
    expect(analyzeRhythm(targets, targets.map((t) => t - ms(25))).tendency).toBe('early');
  });

  it('±20 ms içindekilerin oranı', () => {
    const targets = grid(4);
    const a = analyzeRhythm(targets, [targets[0], targets[1] + ms(19), targets[2] + ms(40), targets[3] - ms(60)]);
    expect(a.within20).toBe(0.5);
  });
});

describe('canlı sapma', () => {
  it('en yakın hedefe göre; yakında hedef yoksa null', () => {
    const targets = grid(4);
    expect(liveDeviation(targets, targets[2] + ms(14), 0, 0.15)).toBeCloseTo(14, 6);
    expect(liveDeviation(targets, targets[3] - ms(30) + 0.08, 0.08, 0.15)).toBeCloseTo(-30, 6);
    expect(liveDeviation(targets, targets[1] + 0.25, 0, 0.15)).toBeNull();
    expect(liveDeviation([], 1, 0, 0.15)).toBeNull();
  });
});

describe('gecikme kestirimi', () => {
  const clicks = grid(8, 0.5, 2);

  it('tıklarla duyulan vuruşlar arasındaki medyan farkı verir', () => {
    const heard = clicks.map((c, i) => c + 0.142 + ms([1, -2, 0, 3, -1, 2, 0, -3][i]));
    const e = estimateLatency(clicks, heard)!;
    expect(e.latencyMs).toBe(142);
    expect(e.matched).toBe(8);
    expect(e.spreadMs).toBeLessThan(3);
  });

  it('aykırı bir ölçüm medyanı bozmaz', () => {
    const heard = clicks.map((c, i) => c + (i === 4 ? 0.4 : 0.09));
    expect(estimateLatency(clicks, heard)!.latencyMs).toBe(90);
  });

  it('yeterli tık duyulmadıysa ölçüm yok', () => {
    expect(estimateLatency(clicks, [])).toBeNull();
    expect(estimateLatency(clicks, clicks.slice(0, 3).map((c) => c + 0.1))).toBeNull();
  });

  it('çalarak ölçümde erken vuruşlar da eşleşir', () => {
    const heard = clicks.map((c) => c - 0.03);
    expect(estimateLatency(clicks, heard)).toBeNull();
    expect(estimateLatency(clicks, heard, 0.12, 0.4)!.latencyMs).toBe(0);
  });
});

describe('sonuç kaydı', () => {
  it('sapmalar hedef sırasıyla saklanır; kaçırılanlar null', () => {
    const targets = grid(4);
    const a = analyzeRhythm(targets, [targets[0] + ms(7.26), targets[2] - ms(12)]);
    const r = toResult(a, { id: 'x', date: 1, bpm: 120, bars: 1, what: 'div:1', source: 'metronome' });
    expect(r.deviations).toEqual([7.3, null, -12, null]);
    expect(r).toMatchObject({ type: 'rhythm', hits: 2, missed: 2, targets: 4 });
    expect(isRhythmResult(r)).toBe(true);
    expect(isRhythmResult({ ...r, deviations: undefined })).toBe(false);
    expect(isRhythmResult(JSON.parse(JSON.stringify(r)))).toBe(true);
  });
});
