import { describe, expect, it } from 'vitest';
import { pairKey, type TransitionResult } from '../../src/features/chords/transitions';
import type { SessionRecord } from '../../src/features/log/stats';
import {
  autoDone,
  choosePairs,
  chooseRhythm,
  dayIndex,
  DEFAULT_PROFILE,
  generatePlan,
  isProfile,
  pairPool,
  QUESTIONS,
  recentSeconds,
  scoreProfile,
  targetRate,
  type PlanInput,
  type PlanMinutes,
  type Profile,
} from '../../src/features/plan/generator';
import type { RhythmResult } from '../../src/features/rhythm/analysis';
import { dictionaries } from '../../src/i18n';
import { primaryShape } from '../../src/music/chords';
import { TEMPLATES } from '../../src/music/progressions';
import { PRESET_PATTERNS } from '../../src/features/metronome/patterns';

const TODAY = '2026-11-15';
const at = (day: number, hour = 18) => new Date(2026, 10, day, hour).getTime();

const profile = (p: Partial<Profile> = {}): Profile => ({ level: 0, open: 0, barre: 0, rhythm: 0, lead: 0, goal: 'all', date: 1, ...p });

const tx = (a: string, b: string, count: number, day: number, seconds = 60): TransitionResult => ({
  id: `${a}${b}${day}${count}`,
  type: 'transition',
  date: at(day),
  a,
  b,
  pair: pairKey(a, b),
  count,
  seconds,
});

const rh = (accuracy: number, bpm: number, what: string, day: number, meanMs = 0): RhythmResult => ({
  id: `r${day}${accuracy}${bpm}`,
  type: 'rhythm',
  date: at(day),
  bpm,
  bars: 8,
  what,
  source: 'metronome',
  targets: 32,
  hits: 32,
  missed: 0,
  extra: 0,
  meanMs,
  absMs: Math.abs(meanMs),
  stdMs: 10,
  accuracy,
  consistency: 80,
  deviations: [],
});

const session = (day: number, activities: Record<string, number>): SessionRecord => ({
  id: `s${day}${Object.keys(activities).join('')}`,
  type: 'session',
  date: at(day),
  seconds: Object.values(activities).reduce((s, v) => s + v, 0),
  activities,
});

const input = (p: Partial<PlanInput> = {}): PlanInput => ({
  profile: profile(),
  minutes: 30,
  today: TODAY,
  transitions: [],
  rhythm: [],
  sessions: [],
  ...p,
});

describe('seviye testi', () => {
  it('yanıtlardan seviye ve beceri profili çıkar', () => {
    expect(scoreProfile({}, 5)).toMatchObject({ level: 0, open: 0, barre: 0, goal: 'chords', date: 5 });
    expect(scoreProfile({ experience: 1, open: 1, rhythm: 1, goal: 3 }, 1)).toMatchObject({ level: 1, open: 1, goal: 'all' });
    expect(scoreProfile({ experience: 2, open: 2, barre: 2, rhythm: 2, lead: 1, goal: 1 }, 1)).toMatchObject({
      level: 2,
      barre: 2,
      lead: 1,
      goal: 'lead',
    });
    // Sınırlar: toplam 2 → yeni başlayan, 3 → temel, 7 → orta.
    expect(scoreProfile({ experience: 1, open: 1 }, 1).level).toBe(0);
    expect(scoreProfile({ experience: 1, open: 1, rhythm: 1 }, 1).level).toBe(1);
    expect(scoreProfile({ experience: 2, open: 2, barre: 1, rhythm: 1, lead: 1 }, 1).level).toBe(2);
  });

  it('sorular ve seçenekler iki dilde de tanımlı', () => {
    for (const q of QUESTIONS) {
      expect(dictionaries.tr[q.text]).toBeTruthy();
      expect(q.options.length).toBeGreaterThanOrEqual(3);
      for (const o of q.options) {
        expect(dictionaries.tr[o.text]).toBeTruthy();
        expect(dictionaries.en[o.text]).toBeTruthy();
      }
      // Seçenek değerleri 0'dan başlayıp sırayla artar.
      expect(q.options.map((o) => o.value)).toEqual(q.options.map((_, i) => i));
    }
    expect(isProfile(DEFAULT_PROFILE)).toBe(true);
    expect(isProfile({ level: 1 })).toBe(false);
  });
});

describe('plan: süre ve yapı', () => {
  it('dakikaların toplamı her zaman seçilen süreye eşit', () => {
    const histories: Partial<PlanInput>[] = [
      {},
      { transitions: [tx('Em', 'G', 12, 10), tx('Am', 'C', 40, 12)], rhythm: [rh(55, 90, 'div:2', 13)] },
      { sessions: [session(14, { chords: 900 }), session(13, { rhythm: 300 })] },
    ];
    for (const minutes of [15, 30, 45] as PlanMinutes[]) {
      for (const level of [0, 1, 2] as const) {
        for (const goal of ['chords', 'lead', 'riffs', 'all'] as const) {
          for (const h of histories) {
            const items = generatePlan(input({ minutes, profile: profile({ level, open: level, barre: level, goal }), ...h }));
            const total = items.reduce((s, it) => s + it.minutes, 0);
            expect(total, `${minutes} dk, seviye ${level}, hedef ${goal}`).toBe(minutes);
            for (const it of items) expect(it.minutes).toBeGreaterThan(0);
            // Kimlikler benzersiz.
            expect(new Set(items.map((it) => it.id)).size).toBe(items.length);
          }
        }
      }
    }
  });

  it('süre uzadıkça madde sayısı artar; akort hep ilk madde', () => {
    const count = (m: PlanMinutes) => generatePlan(input({ minutes: m })).length;
    expect(count(15)).toBe(4);
    expect(count(30)).toBe(5);
    expect(count(45)).toBe(6);
    for (const m of [15, 30, 45] as PlanMinutes[]) expect(generatePlan(input({ minutes: m }))[0].setup.kind).toBe('tune');
    expect(generatePlan(input({ minutes: 45 })).map((it) => it.setup.kind)).toEqual([
      'tune',
      'transition',
      'transition',
      'rhythm',
      'pattern',
      'backing',
    ]);
  });

  it('aynı girdi aynı planı verir; eşlik günden güne değişir', () => {
    expect(generatePlan(input())).toEqual(generatePlan(input()));
    const jam = (day: string) => generatePlan(input({ today: day })).find((it) => it.setup.kind === 'backing')!.id;
    const seen = new Set(['2026-11-15', '2026-11-16', '2026-11-17'].map(jam));
    expect(seen.size).toBeGreaterThan(1);
    expect(dayIndex('2026-11-16') - dayIndex('2026-11-15')).toBe(1);
    expect(dayIndex('2027-01-01') - dayIndex('2026-12-31')).toBe(1);
  });

  it('plandaki her madde gerçekten var olan içeriğe işaret eder', () => {
    for (const level of [0, 1, 2] as const) {
      for (let d = 1; d <= 28; d++) {
        const today = `2026-11-${String(d).padStart(2, '0')}`;
        const items = generatePlan(input({ minutes: 45, today, profile: profile({ level, open: level, barre: level }) }));
        for (const it of items) {
          const s = it.setup;
          if (s.kind === 'transition') {
            expect(primaryShape(s.a), s.a).toBeDefined();
            expect(primaryShape(s.b), s.b).toBeDefined();
          } else if (s.kind === 'backing') {
            expect(TEMPLATES.some((p) => p.id === s.progressionId), s.progressionId).toBe(true);
          } else if (s.kind === 'pattern') {
            const p = PRESET_PATTERNS.find((x) => x.id === s.patternId);
            expect(p?.beats, s.patternId).toBe(4);
          } else if (s.kind === 'rhythm') {
            expect(s.what).toMatch(/^div:[1-4]$/);
            expect(s.bpm).toBeGreaterThanOrEqual(50);
          }
          expect(dictionaries.tr[it.title.key], it.title.key).toBeTruthy();
          expect(dictionaries.tr[it.reason.key], it.reason.key).toBeTruthy();
        }
      }
    }
    // Havuzdaki tüm çiftler kütüphanede var.
    for (const p of [profile(), profile({ open: 2 }), profile({ open: 2, barre: 2 })]) {
      for (const [a, b] of pairPool(p)) {
        expect(primaryShape(a), a).toBeDefined();
        expect(primaryShape(b), b).toBeDefined();
      }
    }
  });
});

describe('plan: akor geçişleri', () => {
  it('geçmiş yokken öğrenme sırasının ilk çiftiyle başlar', () => {
    const [first] = choosePairs(input(), 1);
    expect([first.a, first.b]).toEqual(['Em', 'G']);
    expect(first.reason.key).toBe('plan.why.first');
  });

  it('hedefin altındaki en zayıf çift öne alınır ve nedeni yazılır', () => {
    const transitions = [tx('Em', 'G', 28, 10), tx('Am', 'C', 12, 11), tx('C', 'G', 35, 12)];
    // Gün sırası çift olan günde en zayıf çift, tek olan günde ikinci en zayıf çift seçilir.
    const [evenDay, oddDay] = dayIndex('2026-11-16') % 2 === 0 ? ['2026-11-16', '2026-11-17'] : ['2026-11-17', '2026-11-16'];
    const picks = choosePairs(input({ transitions, today: evenDay }), 2);
    expect(pairKey(picks[0].a, picks[0].b)).toBe(pairKey('Am', 'C'));
    expect(picks[0].reason).toEqual({ key: 'plan.why.weak', params: { a: 'Am', b: 'C', n: 12, target: 30 } });
    // İkinci madde: hiç çalışılmamış sıradaki çift.
    expect([picks[1].a, picks[1].b]).toEqual(['D', 'A']);
    expect(picks[1].reason.key).toBe('plan.why.new');
    // Ertesi gün ikinci en zayıf çifte dönülür.
    const next = choosePairs(input({ transitions, today: oddDay }), 1);
    expect(pairKey(next[0].a, next[0].b)).toBe(pairKey('Em', 'G'));
  });

  it('hedefi geçen çift zayıf sayılmaz; farklı sürelerin sonuçları dakikaya çevrilir', () => {
    // 30 sn'de 16 geçiş = dakikada 32 ≥ 30.
    const picks = choosePairs(input({ transitions: [tx('Em', 'G', 16, 10, 30)] }), 1);
    expect([picks[0].a, picks[0].b]).toEqual(['Am', 'C']);
    expect(targetRate(profile({ level: 2 }))).toBe(60);
  });

  it('hepsi oturmuşsa en uzun süredir çalışılmayan çift gelir', () => {
    const transitions = pairPool(profile()).map(([a, b], i) => tx(a, b, 40, 1 + i));
    const picks = choosePairs(input({ transitions }), 1);
    expect([picks[0].a, picks[0].b].sort()).toEqual(['Em', 'G']);
    expect(picks[0].reason).toMatchObject({ key: 'plan.why.stale', params: { days: 14 } });
  });

  it('seviye ilerledikçe havuz bare ve yedili akorlara kayar', () => {
    expect(pairPool(profile())[0]).toEqual(['Em', 'G']);
    expect(pairPool(profile({ open: 2 })).some(([a]) => a === 'F')).toBe(true);
    expect(pairPool(profile({ open: 2, barre: 2 }))[0]).toEqual(['F', 'C']);
    const p = generatePlan(input({ profile: profile({ level: 2, open: 2, barre: 2 }) }));
    expect(p.find((it) => it.setup.kind === 'transition')!.id).toBe('transition:' + pairKey('F', 'C'));
  });
});

describe('plan: ritim', () => {
  it('geçmiş yokken seviyeye göre başlangıç', () => {
    expect(chooseRhythm(input())).toMatchObject({ bpm: 70, what: 'div:1', reason: { key: 'plan.why.rhythmFirst' } });
    expect(chooseRhythm(input({ profile: profile({ level: 2 }) }))).toMatchObject({ bpm: 90, what: 'div:2' });
  });

  it('isabet düşükse yavaşlatır, ortadaysa aynı tempoda tutar, yüksekse zorlaştırır', () => {
    expect(chooseRhythm(input({ rhythm: [rh(45, 100, 'div:2', 14)] }))).toMatchObject({
      bpm: 90,
      what: 'div:2',
      reason: { key: 'plan.why.rhythmSlow', params: { n: 45 } },
    });
    expect(chooseRhythm(input({ rhythm: [rh(45, 55, 'div:1', 14)] })).bpm).toBe(50);
    expect(chooseRhythm(input({ rhythm: [rh(72, 100, 'div:2', 14)] }))).toMatchObject({
      bpm: 100,
      reason: { key: 'plan.why.rhythmHold' },
    });
    // Dörtlüklerde iyi: önce sekizliğe geç.
    expect(chooseRhythm(input({ rhythm: [rh(92, 80, 'div:1', 14)] }))).toMatchObject({ bpm: 80, what: 'div:2' });
    // Sekizliklerde iyi: tempoyu artır.
    expect(chooseRhythm(input({ rhythm: [rh(92, 80, 'div:2', 14)] }))).toMatchObject({
      bpm: 85,
      what: 'div:2',
      reason: { key: 'plan.why.rhythmUp' },
    });
  });

  it('son üç ölçümün ortalamasına bakar; belirgin erken/geç eğilimi nedene yansır', () => {
    const rhythm = [rh(95, 80, 'div:2', 10), rh(50, 80, 'div:2', 12), rh(52, 80, 'div:2', 13), rh(54, 80, 'div:2', 14)];
    expect(chooseRhythm(input({ rhythm })).reason.key).toBe('plan.why.rhythmSlow');
    expect(chooseRhythm(input({ rhythm: [rh(70, 90, 'div:2', 14, -32)] })).reason).toEqual({
      key: 'plan.why.rhythmEarly',
      params: { n: 32 },
    });
    expect(chooseRhythm(input({ rhythm: [rh(70, 90, 'div:2', 14, 27)] })).reason.key).toBe('plan.why.rhythmLate');
    // Kalıpla yapılan ölçümden sonra düz sekizliklere dönülür.
    expect(chooseRhythm(input({ rhythm: [rh(70, 90, 'pattern:folk', 14)] })).what).toBe('div:2');
  });
});

describe('plan: ihmal edilen konu ve hedef', () => {
  it('bu hafta hiç çalışılmayan konu belirtilir ve bir dakika fazla alır', () => {
    const sessions = [session(14, { chords: 1200, rhythm: 600 }), session(5, { backing: 900 })];
    expect(recentSeconds(sessions, TODAY, 'chords')).toBe(1200);
    // 5 Kasım, son 7 günün dışında.
    expect(recentSeconds(sessions, TODAY, 'backing')).toBe(0);
    const items = generatePlan(input({ sessions }));
    const backing = items.find((it) => it.setup.kind === 'backing')!;
    expect(backing.reason.key).toBe('plan.why.neglected');
    expect(backing.minutes).toBe(10);
    expect(items[0].minutes).toBe(1);
  });

  it('hiç kayıt yokken hiçbir konu "ihmal edilmiş" sayılmaz', () => {
    const items = generatePlan(input());
    expect(items.some((it) => it.reason.key === 'plan.why.neglected')).toBe(false);
    expect(items[0].minutes).toBe(2);
  });

  it('hedef, dakikaları akor ile doğaçlama arasında kaydırır', () => {
    const mins = (goal: Profile['goal']) => {
      const items = generatePlan(input({ profile: profile({ goal }) }));
      return [items.find((it) => it.setup.kind === 'transition')!.minutes, items.find((it) => it.setup.kind === 'backing')!.minutes];
    };
    expect(mins('all')).toEqual([6, 9]);
    expect(mins('lead')).toEqual([4, 11]);
    expect(mins('chords')).toEqual([8, 7]);
  });
});

describe('plan: kendiliğinden tamamlanan maddeler', () => {
  it('bugün kaydedilen geçiş ve ritim sonuçları maddeyi tamamlar', () => {
    const items = generatePlan(input());
    const transition = items.find((it) => it.setup.kind === 'transition')!;
    const rhythm = items.find((it) => it.setup.kind === 'rhythm')!;
    expect(autoDone(items, { today: TODAY, transitions: [], rhythm: [] })).toEqual([]);
    // Dünkü sonuç saymaz; bugünkü sayar. Akor sırası fark etmez.
    expect(autoDone(items, { today: TODAY, transitions: [tx('G', 'Em', 10, 14)], rhythm: [] })).toEqual([]);
    expect(autoDone(items, { today: TODAY, transitions: [tx('G', 'Em', 10, 15)], rhythm: [rh(70, 70, 'div:1', 15)] })).toEqual([
      transition.id,
      rhythm.id,
    ]);
    // Başka bir çiftin sonucu bu maddeyi tamamlamaz.
    expect(autoDone(items, { today: TODAY, transitions: [tx('D', 'A', 10, 15)], rhythm: [] })).toEqual([]);
  });
});
