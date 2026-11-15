import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/audio/synth/karplus';
import {
  CHORD_LEVELS,
  EAR_ROUND,
  earLevels,
  earScore,
  INTERVAL_GAP,
  INTERVAL_LEVELS,
  isEarResult,
  isPass,
  itemAccuracy,
  itemIntervals,
  makeRound,
  questionNotes,
  tally,
  unlockedLevel,
  type EarKind,
  type EarResult,
} from '../../src/music/ear';
import { QUALITIES } from '../../src/music/theory';

function result(kind: EarKind, level: number, correct: number, total = 10, items: EarResult['items'] = {}): EarResult {
  return { id: `${kind}-${level}-${correct}-${Math.random()}`, type: 'ear', date: 1, kind, level, correct, total, seconds: 30, items };
}

describe('seviyeler', () => {
  it('her seviye bir öncekinin türlerini içerir ve en az iki seçenek sunar', () => {
    for (const levels of [INTERVAL_LEVELS, CHORD_LEVELS]) {
      expect(levels).toHaveLength(6);
      levels.forEach((level, i) => {
        expect(level.items.length).toBeGreaterThanOrEqual(2);
        expect(new Set(level.items).size).toBe(level.items.length);
        if (i > 0) for (const item of levels[i - 1].items) expect(level.items).toContain(item);
      });
    }
  });

  it('aralıklar 1–12 yarım ton, akorlar bilinen türlerdir', () => {
    for (const level of INTERVAL_LEVELS) for (const item of level.items) expect(Number(item)).toBeGreaterThanOrEqual(1);
    for (const level of INTERVAL_LEVELS) for (const item of level.items) expect(Number(item)).toBeLessThanOrEqual(12);
    for (const level of CHORD_LEVELS) for (const item of level.items) expect(QUALITIES).toHaveProperty(item);
    expect(INTERVAL_LEVELS[5].items).toHaveLength(12);
    expect(itemIntervals('interval', '7')).toEqual([0, 7]);
    expect(itemIntervals('chord', 'm7')).toEqual([0, 3, 7, 10]);
  });
});

describe('tur üretimi', () => {
  it('soruları seviyenin türlerinden, dengeli ve gitar aralığında üretir', () => {
    for (const kind of ['interval', 'chord'] as const) {
      earLevels(kind).forEach((def, i) => {
        for (let seed = 1; seed <= 25; seed++) {
          const round = makeRound(kind, i + 1, mulberry32(seed));
          expect(round).toHaveLength(EAR_ROUND);
          const counts = new Map<string, number>();
          for (const q of round) {
            expect(def.items).toContain(q.item);
            expect(def.directions).toContain(q.direction);
            counts.set(q.item, (counts.get(q.item) ?? 0) + 1);
            for (const note of questionNotes(q)) {
              expect(note.midi).toBeGreaterThanOrEqual(40);
              expect(note.midi).toBeLessThanOrEqual(76);
            }
          }
          const floor = Math.floor(EAR_ROUND / def.items.length);
          if (floor >= 1) {
            for (const item of def.items) {
              expect(counts.get(item) ?? 0).toBeGreaterThanOrEqual(floor);
              expect(counts.get(item) ?? 0).toBeLessThanOrEqual(floor + 1);
            }
          } else {
            // Türler sorudan çoksa hiçbiri yinelenmez.
            expect(counts.size).toBe(EAR_ROUND);
          }
          for (let k = 1; k < round.length; k++) expect(round[k].rootMidi).not.toBe(round[k - 1].rootMidi);
        }
      });
    }
  });

  it('aynı tohumla aynı tur, farklı tohumla farklı tur üretir', () => {
    const a = makeRound('interval', 5, mulberry32(7));
    expect(makeRound('interval', 5, mulberry32(7))).toEqual(a);
    expect(makeRound('interval', 5, mulberry32(8))).not.toEqual(a);
  });

  it('geçersiz seviye en yakın geçerli seviyeye çekilir', () => {
    expect(makeRound('chord', 0, mulberry32(1)).every((q) => ['maj', 'min'].includes(q.item))).toBe(true);
    expect(makeRound('chord', 99, mulberry32(1))).toHaveLength(EAR_ROUND);
  });
});

describe('çalınacak notalar', () => {
  it('çıkıcı, inici ve birlikte aralıklar', () => {
    expect(questionNotes({ kind: 'interval', item: '7', rootMidi: 57, direction: 'up' })).toEqual([
      { midi: 57, at: 0 },
      { midi: 64, at: INTERVAL_GAP },
    ]);
    expect(questionNotes({ kind: 'interval', item: '3', rootMidi: 60, direction: 'down' })).toEqual([
      { midi: 60, at: 0 },
      { midi: 57, at: INTERVAL_GAP },
    ]);
    expect(questionNotes({ kind: 'interval', item: '12', rootMidi: 50, direction: 'together' })).toEqual([
      { midi: 50, at: 0 },
      { midi: 62, at: 0 },
    ]);
  });

  it('akor notaları aynı anda, kökten yukarı', () => {
    const q = { kind: 'chord', item: 'maj7', rootMidi: 48, direction: 'together' } as const;
    expect(questionNotes(q).map((n) => n.midi)).toEqual([48, 52, 55, 59]);
    expect(questionNotes(q).every((n) => n.at === 0)).toBe(true);
    // Yanlış yanıtı aynı kökten dinleme.
    expect(questionNotes(q, 'm7').map((n) => n.midi)).toEqual([48, 51, 55, 58]);
  });
});

describe('puan ve seviye ilerlemesi', () => {
  it('puan doğruluk yüzdesidir', () => {
    expect(earScore(8, 10)).toBe(80);
    expect(earScore(0, 0)).toBe(0);
    expect(earScore(2, 3)).toBe(67);
  });

  it('seviye, tam bir turda en az %80 ile geçilir', () => {
    expect(isPass({ correct: 8, total: 10 })).toBe(true);
    expect(isPass({ correct: 7, total: 10 })).toBe(false);
    // Yarıda bırakılan tur sayılmaz.
    expect(isPass({ correct: 4, total: 4 })).toBe(false);
  });

  it('seviyeler sırayla açılır ve türler birbirinden bağımsızdır', () => {
    expect(unlockedLevel([], 'interval')).toBe(1);
    expect(unlockedLevel([result('interval', 1, 7)], 'interval')).toBe(1);
    expect(unlockedLevel([result('interval', 1, 7), result('interval', 1, 9)], 'interval')).toBe(2);
    expect(unlockedLevel([result('interval', 1, 9)], 'chord')).toBe(1);
    // Aradaki seviye geçilmeden üsttekinin sonucu ilerletmez (ör. içe aktarılmış veri).
    expect(unlockedLevel([result('chord', 1, 10), result('chord', 3, 10)], 'chord')).toBe(2);
    const all = [1, 2, 3, 4, 5, 6].map((l) => result('chord', l, 10));
    expect(unlockedLevel(all, 'chord')).toBe(6);
  });

  it('soru türü başına doğruluk tüm turlardan toplanır; en zayıf başta', () => {
    let t1 = {};
    t1 = tally(t1, '4', true);
    t1 = tally(t1, '4', false);
    t1 = tally(t1, '7', true);
    expect(t1).toEqual({ '4': [2, 1], '7': [1, 1] });
    const results = [
      result('interval', 1, 2, 3, t1),
      result('interval', 1, 3, 4, { '4': [2, 2], '12': [2, 1] }),
      result('chord', 1, 1, 1, { maj: [1, 1] }),
    ];
    expect(itemAccuracy(results, 'interval')).toEqual([
      { item: '12', asked: 2, correct: 1, percent: 50 },
      { item: '4', asked: 4, correct: 3, percent: 75 },
      { item: '7', asked: 1, correct: 1, percent: 100 },
    ]);
    expect(itemAccuracy(results, 'chord')).toEqual([{ item: 'maj', asked: 1, correct: 1, percent: 100 }]);
    expect(itemAccuracy([], 'chord')).toEqual([]);
  });

  it('kayıt biçimi denetlenir', () => {
    expect(isEarResult(result('interval', 1, 5))).toBe(true);
    expect(isEarResult({ ...result('interval', 1, 5), kind: 'melody' })).toBe(false);
    expect(isEarResult({ ...result('interval', 1, 5), type: 'fretgame' })).toBe(false);
    expect(isEarResult({ ...result('interval', 1, 5), items: undefined })).toBe(false);
    expect(isEarResult(null)).toBe(false);
  });
});
