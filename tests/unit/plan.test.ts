import { describe, expect, it } from 'vitest';
import { pairKey, type TransitionResult } from '../../src/features/chords/transitions';
import type { SessionRecord } from '../../src/features/log/stats';
import {
  autoDone,
  chooseEar,
  chooseExtras,
  choosePairs,
  chooseRepertoire,
  chooseRhythm,
  chooseTheory,
  dayIndex,
  daysSinceExtra,
  DEFAULT_PROFILE,
  GAME_STEPS,
  generatePlan,
  isProfile,
  pairPool,
  PIECE_LEVEL,
  QUESTIONS,
  recentSeconds,
  scoreProfile,
  STALE_CAP,
  targetRate,
  type Piece,
  type PlanInput,
  type PlanItem,
  type PlanMinutes,
  type Profile,
  type Text,
} from '../../src/features/plan/generator';
import type { RhythmResult } from '../../src/features/rhythm/analysis';
import { BUILTIN_SONGS } from '../../src/features/songs/builtin';
import { BUILTIN_TABS } from '../../src/features/tabs/builtin';
import { dictionaries } from '../../src/i18n';
import { parseChordPro } from '../../src/music/chordpro';
import { primaryShape } from '../../src/music/chords';
import { earLevels, type EarKind, type EarResult } from '../../src/music/ear';
import type { GameMode, GameResult } from '../../src/music/fretboard';
import { TEMPLATES } from '../../src/music/progressions';
import { SCALES } from '../../src/music/scales';
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

const earResult = (kind: EarKind, level: number, correct: number, day: number, items: Record<string, [number, number]> = {}): EarResult => ({
  id: `e${kind}${level}${day}${correct}`,
  type: 'ear',
  date: at(day),
  kind,
  level,
  correct,
  total: 10,
  seconds: 60,
  items,
});

const game = (correct: number, day: number, mode: GameMode = 'name', maxFret = 5, naturalsOnly = true): GameResult => ({
  id: `g${day}${correct}${mode}${maxFret}${naturalsOnly}`,
  type: 'fretgame',
  date: at(day),
  mode,
  maxFret,
  naturalsOnly,
  correct,
  total: 10,
  seconds: 50,
});

/** Uygulamanın plana verdiği hazır parçalarla aynı liste. */
const SONGS: Piece[] = BUILTIN_SONGS.map((r) => {
  const song = parseChordPro(r.text);
  return { id: r.id, name: song.title, bpm: song.tempo ?? r.bpm };
});
const TABS: Piece[] = BUILTIN_TABS.map((tab) => ({ id: tab.id, name: tab.name, bpm: tab.bpm }));

const input = (p: Partial<PlanInput> = {}): PlanInput => ({
  profile: profile(),
  minutes: 30,
  today: TODAY,
  transitions: [],
  rhythm: [],
  sessions: [],
  ear: [],
  fretgame: [],
  songs: SONGS,
  tabs: TABS,
  ...p,
});

/** Gün sırası çift / tek olan iki gün (günden güne dönen seçimler için). */
const [EVEN_DAY, ODD_DAY] = dayIndex('2026-11-16') % 2 === 0 ? ['2026-11-16', '2026-11-17'] : ['2026-11-17', '2026-11-16'];

const kinds = (items: PlanItem[]) => items.map((it) => it.setup.kind);

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
      {
        ear: [earResult('interval', 1, 9, 12), earResult('chord', 1, 4, 13, { min: [5, 2] })],
        fretgame: [game(10, 13), game(9, 14, 'find')],
        sessions: [session(14, { song: 600, tab: 300, ear: 200, theory: 100 })],
      },
      // Hiç parça yokken şarkı/tab maddesinin dakikası eşliğe geçer.
      { songs: [], tabs: [] },
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

  it('süre uzadıkça madde sayısı artar; akort hep ilk madde; ek konular 1 / 2 / 3', () => {
    const count = (m: PlanMinutes) => generatePlan(input({ minutes: m })).length;
    expect(count(15)).toBe(5);
    expect(count(30)).toBe(7);
    expect(count(45)).toBe(9);
    for (const m of [15, 30, 45] as PlanMinutes[]) expect(generatePlan(input({ minutes: m }))[0].setup.kind).toBe('tune');
    // 45 dakikada üç ek konunun hepsi var; gösterim sırası sabit (gam/oyun eşlikten önce, şarkı/tab ve kulak sonra).
    const repertoire = chooseRepertoire(input())!.kind;
    expect(kinds(generatePlan(input({ minutes: 45 })))).toEqual([
      'tune',
      'transition',
      'transition',
      'rhythm',
      'pattern',
      'fretgame',
      'backing',
      repertoire,
      'ear',
    ]);
    // 15 dakikada yalnızca en öncelikli ek konu.
    const first = chooseExtras(input())[0];
    const extraKinds = { ear: ['ear'], theory: ['fretgame', 'scale'], repertoire: ['song', 'tab'] }[first];
    expect(kinds(generatePlan(input({ minutes: 15 }))).filter((k) => !['tune', 'transition', 'rhythm', 'backing'].includes(k))).toSatisfy(
      (rest: string[]) => rest.length === 1 && extraKinds.includes(rest[0]),
    );
  });

  it('hiç parça yoksa şarkı/tab maddesi çıkmaz, dakikası eşliğe eklenir', () => {
    const p = profile({ goal: 'chords' });
    expect(chooseExtras(input({ profile: p }))[0]).toBe('repertoire');
    const items = generatePlan(input({ profile: p, minutes: 15, songs: [], tabs: [] }));
    expect(kinds(items)).toEqual(['tune', 'transition', 'rhythm', 'backing']);
    expect(items.find((it) => it.setup.kind === 'backing')!.minutes).toBe(3 + 3);
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
    const textOk = (x: Text) => {
      for (const lang of ['tr', 'en'] as const) {
        expect(dictionaries[lang][x.key], x.key).toBeTruthy();
        for (const ref of Object.values(x.refs ?? {})) expect(dictionaries[lang][ref], ref).toBeTruthy();
        // Tüm yer tutucular doldurulmuş.
        const names = [...dictionaries[lang][x.key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        for (const n of names) expect({ ...x.params, ...x.refs }, `${x.key} {${n}}`).toHaveProperty(n);
      }
    };
    // Kulak ve oyun sonuçlarıyla zengin geçmiş: zayıf aralık, ilerlemiş oyun basamakları, gam önerisi.
    const rich: Partial<PlanInput> = {
      ear: [
        earResult('interval', 1, 9, 20, { '4': [5, 5], '7': [5, 4] }),
        earResult('interval', 2, 6, 21, { '3': [4, 1], '5': [6, 5] }),
        earResult('chord', 1, 8, 22, { maj: [5, 5], min: [5, 3] }),
      ],
      fretgame: [game(10, 20), game(10, 21, 'find'), game(9, 22, 'name', 12)],
    };
    for (const level of [0, 1, 2] as const) {
      for (const goal of ['chords', 'lead', 'riffs', 'all'] as const) {
        for (const history of [{}, rich]) {
          for (let d = 1; d <= 28; d++) {
            const today = `2026-11-${String(d).padStart(2, '0')}`;
            const items = generatePlan(input({ minutes: 45, today, profile: profile({ level, open: level, barre: level, goal }), ...history }));
            for (const it of items) {
              textOk(it.title);
              textOk(it.reason);
              const s = it.setup;
              if (s.kind === 'ear') {
                expect(s.level).toBeGreaterThanOrEqual(1);
                expect(s.level).toBeLessThanOrEqual(earLevels(s.earKind).length);
              } else if (s.kind === 'fretgame') {
                expect([5, 12]).toContain(s.maxFret);
                expect(['name', 'find']).toContain(s.mode);
              } else if (s.kind === 'scale') {
                expect(SCALES[s.scale], s.scale).toBeDefined();
                // Gam, aynı plandaki eşliğin tonunda.
                const jam = items.find((x) => x.setup.kind === 'backing')!.setup;
                expect(jam.kind === 'backing' && jam.key).toBe(s.root);
              } else if (s.kind === 'song') {
                expect(BUILTIN_SONGS.some((x) => x.id === s.id), s.id).toBe(true);
                expect(PIECE_LEVEL[s.id]).toBeLessThanOrEqual(level);
              } else if (s.kind === 'tab') {
                expect(BUILTIN_TABS.some((x) => x.id === s.id), s.id).toBe(true);
                expect(PIECE_LEVEL[s.id]).toBeLessThanOrEqual(level);
                expect([50, 75, 100]).toContain(s.speed);
              }
            }
          }
        }
      }
    }
    // Zorluk tablosundaki her hazır parça gerçekten var; her hazır parçanın zorluğu tanımlı.
    for (const id of Object.keys(PIECE_LEVEL)) expect([...BUILTIN_SONGS, ...BUILTIN_TABS].some((x) => x.id === id), id).toBe(true);
    for (const x of [...BUILTIN_SONGS, ...BUILTIN_TABS]) expect(PIECE_LEVEL[x.id], x.id).toBeDefined();
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
    expect(backing.minutes).toBe(7);
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
    expect(mins('all')).toEqual([5, 6]);
    expect(mins('lead')).toEqual([3, 8]);
    expect(mins('chords')).toEqual([7, 4]);
  });
});

describe('plan: ek konuların seçimi', () => {
  it('geçmiş yokken hedefe göre sıra; "hepsi" hedefinde sıra günden güne döner', () => {
    const order = (goal: Profile['goal'], today = TODAY) => chooseExtras(input({ profile: profile({ goal }), today }));
    expect(order('chords')).toEqual(['repertoire', 'ear', 'theory']);
    expect(order('lead')).toEqual(['theory', 'ear', 'repertoire']);
    expect(order('riffs')).toEqual(['repertoire', 'theory', 'ear']);
    const firsts = new Set(['2026-11-15', '2026-11-16', '2026-11-17'].map((d) => order('all', d)[0]));
    expect(firsts.size).toBe(3);
  });

  it('uzun süredir çalışılmayan konu hedefin önceliğini geçer', () => {
    // Akor hedefli, şarkıyı dün çalmış; kulak ve sap hiç çalışılmamış.
    const sessions = [session(14, { song: 900 })];
    expect(daysSinceExtra(input({ sessions }), 'repertoire')).toBe(1);
    expect(daysSinceExtra(input({ sessions }), 'ear')).toBeNull();
    expect(chooseExtras(input({ profile: profile({ goal: 'chords' }), sessions }))).toEqual(['ear', 'theory', 'repertoire']);
    // Kulak sonucu da "çalışıldı" sayılır.
    const ear = [earResult('interval', 1, 9, 12)];
    expect(daysSinceExtra(input({ ear }), 'ear')).toBe(3);
    // Hepsi yakın zamanda çalışıldıysa hedef sırası geçerli.
    const all = [session(14, { song: 300, ear: 300, theory: 300 })];
    expect(chooseExtras(input({ profile: profile({ goal: 'chords' }), sessions: all }))).toEqual(['repertoire', 'ear', 'theory']);
    // Çok eski çalışma da en fazla STALE_CAP gün sayılır.
    expect(daysSinceExtra(input({ sessions: [session(1, { tab: 60 })] }), 'repertoire')).toBe(14);
    expect(STALE_CAP).toBe(14);
  });

  it('bugünün kayıtları seçimi değiştirmez: plan gün içinde sabit kalır', () => {
    const before = input({ minutes: 45, profile: profile({ goal: 'chords' }) });
    const after = input({
      minutes: 45,
      profile: profile({ goal: 'chords' }),
      ear: [earResult('chord', 1, 10, 15, { maj: [5, 5], min: [5, 5] })],
      fretgame: [game(10, 15)],
      sessions: [session(15, { song: 900, ear: 300, theory: 300 })],
    });
    expect(generatePlan(after).map((it) => it.id)).toEqual(generatePlan(before).map((it) => it.id));
  });
});

describe('plan: kulak eğitimi', () => {
  it('geçmiş yokken 1. seviye; tür hedefe göre, "hepsi"nde günden güne', () => {
    expect(chooseEar(input({ profile: profile({ goal: 'chords' }) }))).toEqual({ kind: 'chord', level: 1, reason: { key: 'plan.why.earFirst' } });
    expect(chooseEar(input({ profile: profile({ goal: 'lead' }) })).kind).toBe('interval');
    expect(chooseEar(input({ today: EVEN_DAY })).kind).toBe('interval');
    expect(chooseEar(input({ today: ODD_DAY })).kind).toBe('chord');
  });

  it('iki türden açık seviyesi düşük olan seçilir; en zayıf soru türü nedene yazılır', () => {
    // Aralıklarda 1 ve 2 geçilmiş (3 açık), akorlarda 1. seviye geçilmemiş.
    const ear = [
      earResult('interval', 1, 9, 10),
      earResult('interval', 2, 8, 11),
      earResult('chord', 1, 6, 12, { maj: [5, 4], min: [5, 2] }),
    ];
    const c = chooseEar(input({ ear }));
    expect(c.kind).toBe('chord');
    expect(c.level).toBe(1);
    expect(c.reason).toEqual({ key: 'plan.why.earWeak', params: { n: 40 }, refs: { name: 'ear.chord.min' } });
    const item = generatePlan(input({ ear, minutes: 45 })).find((it) => it.setup.kind === 'ear')!;
    expect(item.id).toBe('ear:chord:1');
    expect(item.title).toEqual({ key: 'plan.item.earChord', params: { level: 1 } });
    expect(item.setup).toEqual({ kind: 'ear', earKind: 'chord', level: 1 });
  });

  it('aralıkta zayıf olan: seviyedeki türlerden, en az 3 kez sorulmuş ve %80 altı', () => {
    const ear = [
      earResult('chord', 1, 9, 10),
      earResult('chord', 2, 9, 11),
      // 3. seviyede değil (1 = küçük ikili): sayılmaz. 4 (büyük üçlü) yalnızca 2 kez sorulmuş: sayılmaz.
      earResult('interval', 1, 7, 12, { '4': [2, 0], '7': [4, 3], '12': [4, 4] }),
    ];
    expect(chooseEar(input({ ear }))).toMatchObject({
      kind: 'interval',
      level: 1,
      reason: { key: 'plan.why.earWeak', params: { n: 75 }, refs: { name: 'interval.7' } },
    });
    // Zayıf tür yoksa seviye geçme ölçütü yazılır.
    const ok = [earResult('chord', 1, 9, 10), earResult('interval', 1, 7, 12, { '7': [4, 4] })];
    expect(chooseEar(input({ ear: ok })).reason).toEqual({ key: 'plan.why.earLevel', params: { need: 8, total: 10 } });
  });

  it('son seviye geçildiyse "koru" der', () => {
    const levels = earLevels('interval').length;
    const ear = [...Array.from({ length: levels }, (_, i) => earResult('interval', i + 1, 10, 5 + i)), ...Array.from({ length: levels }, (_, i) => earResult('chord', i + 1, 10, 5 + i))];
    expect(chooseEar(input({ ear, profile: profile({ goal: 'lead' }) }))).toEqual({
      kind: 'interval',
      level: levels,
      reason: { key: 'plan.why.earTop' },
    });
  });
});

describe('plan: sap ve teori', () => {
  const jam = { key: 9, scale: 'minorPent' as const };

  it('hiç oynanmadıysa nota oyunu; ilk basamak seviyeye göre', () => {
    expect(chooseTheory(input(), jam)).toEqual({ kind: 'fretgame', step: GAME_STEPS[0], reason: { key: 'plan.why.gameFirst' } });
    expect(chooseTheory(input({ profile: profile({ level: 2 }) }), jam)).toMatchObject({ step: { mode: 'name', maxFret: 12, naturals: true } });
  });

  it('puan düşükse oyun, oturmuş basamak atlanır', () => {
    // Son üç tur ortalaması %70.
    const low = [game(6, 12), game(7, 13), game(8, 14)];
    expect(chooseTheory(input({ fretgame: low }), jam)).toEqual({
      kind: 'fretgame',
      step: GAME_STEPS[0],
      reason: { key: 'plan.why.gameLow', params: { n: 70, target: 80 } },
    });
    // 1. basamak %90 ile oturmuş; "perdeyi bul"da düşük → 2. basamak.
    const mixed = [game(9, 12), game(6, 13, 'find'), game(6, 14, 'find')];
    expect(chooseTheory(input({ fretgame: mixed }), jam)).toMatchObject({ kind: 'fretgame', step: GAME_STEPS[1] });
  });

  it('puan iyi ve yakın zamanda oynandıysa eşliğin tonunda gam; uzun süredir oynanmadıysa yine oyun', () => {
    const good = [game(9, 12), game(10, 14, 'find')];
    expect(chooseTheory(input({ fretgame: good }), jam)).toEqual({
      kind: 'scale',
      root: 9,
      scale: 'minorPent',
      reason: { key: 'plan.why.scale', params: { key: 'A' } },
    });
    const old = [game(9, 3), game(10, 4, 'find')];
    expect(chooseTheory(input({ fretgame: old }), jam)).toEqual({
      kind: 'fretgame',
      step: GAME_STEPS[2],
      reason: { key: 'plan.why.gameStale', params: { days: 11 } },
    });
    // Planda gam maddesi: başlık gamın adını çevrilecek anahtarla taşır; ayar eşlikle aynı ton.
    const items = generatePlan(input({ fretgame: good, minutes: 45 }));
    const scale = items.find((it) => it.setup.kind === 'scale')!;
    const backing = items.find((it) => it.setup.kind === 'backing')!;
    expect(backing.setup.kind === 'backing' && backing.setup.key).toBe(scale.setup.kind === 'scale' && scale.setup.root);
    expect(scale.title.refs?.scale).toMatch(/^scale\./);
  });
});

describe('plan: şarkı ve tab', () => {
  it('yeni başlayana yalnızca kolay parçalar, yavaşlatılmış', () => {
    for (let d = 1; d <= 30; d++) {
      const today = `2026-11-${String(d).padStart(2, '0')}`;
      const r = chooseRepertoire(input({ today }))!;
      expect(PIECE_LEVEL[r.piece.id]).toBe(0);
      if (r.kind === 'song') {
        expect(r.piece.id).toBe('builtin:dort-akor');
        expect(r.bpm).toBe(63); // 84 × %75
        expect(r.percent).toBe(75);
      } else {
        expect(r.speed).toBe(50);
      }
    }
    // Orta seviyede özgün tempo / tam hız.
    for (let d = 1; d <= 6; d++) {
      const r = chooseRepertoire(input({ profile: profile({ level: 2, goal: 'riffs' }), today: `2026-11-0${d}` }))!;
      if (r.kind === 'tab') expect(r.speed).toBe(100);
      else expect([r.percent, r.bpm]).toEqual([100, r.piece.bpm]);
    }
  });

  it('hedefe göre şarkı/tab oranı; parça günden güne döner; kullanıcının parçaları da girer', () => {
    const days = Array.from({ length: 30 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`);
    const count = (goal: Profile['goal'], kind: string) =>
      days.filter((today) => chooseRepertoire(input({ today, profile: profile({ level: 2, goal }) }))!.kind === kind).length;
    expect(count('chords', 'song')).toBe(20);
    expect(count('riffs', 'tab')).toBe(20);
    expect(count('all', 'song')).toBe(15);
    // Bütün hazır parçalar sırayla gelir.
    const seen = new Set(days.map((today) => chooseRepertoire(input({ today, profile: profile({ level: 2 }) }))!.piece.id));
    expect(seen.size).toBe(SONGS.length + TABS.length);
    // Kullanıcının kendi şarkısı (zorluk tablosunda yok) yeni başlayana da önerilir.
    const mine: Piece = { id: 'user-1', name: 'Benim şarkım', bpm: 120 };
    const seenMine = days.some((today) => chooseRepertoire(input({ today, songs: [...SONGS, mine] }))!.piece.id === 'user-1');
    expect(seenMine).toBe(true);
    // Şarkı yoksa tab'a düşer.
    expect(chooseRepertoire(input({ songs: [], profile: profile({ goal: 'chords' }) }))!.kind).toBe('tab');
    expect(chooseRepertoire(input({ songs: [], tabs: [] }))).toBeNull();
  });

  it('plan maddesi: başlık, neden ve "Başla" ayarı', () => {
    const items = generatePlan(input({ minutes: 45, profile: profile({ level: 1, goal: 'chords' }), today: EVEN_DAY }));
    const it = items.find((x) => x.setup.kind === 'song' || x.setup.kind === 'tab')!;
    const s = it.setup;
    if (s.kind === 'song') {
      expect(it.title.key).toBe('plan.item.song');
      expect(it.reason).toEqual({ key: 'plan.why.songSlow', params: { n: 90 } });
      expect(it.id).toBe(`song:${s.id}`);
    } else {
      expect(s.kind === 'tab' && s.speed).toBe(75);
      expect(it.reason.key).toBe('plan.why.tabSlow');
    }
    // "Riff" hedefinde üç günün ikisi tab: ilk üç günden birinde mutlaka var.
    const full = ['2026-11-01', '2026-11-02', '2026-11-03']
      .map((today) => generatePlan(input({ minutes: 45, profile: profile({ level: 2, goal: 'riffs' }), today })).find((x) => x.setup.kind === 'tab'))
      .find(Boolean)!;
    expect(full.reason.key).toBe('plan.why.tab');
    expect(full.title).toMatchObject({ key: 'plan.item.tab', params: { n: 100 } });
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

  it('bugünkü kulak ve nota oyunu sonuçları; gam, şarkı ve tab için bugünkü oturum süresi', () => {
    const base = { today: TODAY, transitions: [], rhythm: [] };
    const ear: PlanItem = { id: 'ear:chord:1', minutes: 4, title: { key: 'plan.item.earChord' }, reason: { key: 'plan.why.earFirst' }, setup: { kind: 'ear', earKind: 'chord', level: 1 } };
    const fret: PlanItem = { ...ear, id: 'fretgame', setup: { kind: 'fretgame', mode: 'name', maxFret: 5, naturals: true } };
    const scale: PlanItem = { ...ear, id: 'scale', setup: { kind: 'scale', root: 9, scale: 'minorPent' } };
    const song: PlanItem = { ...ear, id: 'song', setup: { kind: 'song', id: 'builtin:dort-akor', bpm: 63 } };
    const tab: PlanItem = { ...ear, id: 'tab', setup: { kind: 'tab', id: 'builtin:kromatik', speed: 50 } };
    const items = [ear, fret, scale, song, tab];
    expect(autoDone(items, base)).toEqual([]);
    // Kulak: bugünkü, aynı türden tur. Dünkü ya da öbür tür saymaz.
    expect(autoDone(items, { ...base, ear: [earResult('chord', 1, 3, 14), earResult('interval', 1, 9, 15)] })).toEqual([]);
    expect(autoDone(items, { ...base, ear: [earResult('chord', 1, 3, 15)] })).toEqual(['ear:chord:1']);
    // Nota oyunu: bugünkü herhangi bir tur (yarım puan da olsa çalışıldı).
    expect(autoDone(items, { ...base, fretgame: [game(4, 15, 'find', 12)] })).toEqual(['fretgame']);
    // Oturum süresi: 4 dakikalık maddenin en az yarısı (120 sn) bugün o araçta geçmeli.
    expect(autoDone(items, { ...base, sessions: [session(15, { song: 100, tab: 119, theory: 60 })] })).toEqual([]);
    expect(
      autoDone(items, { ...base, sessions: [session(15, { song: 100, theory: 60 }), { ...session(15, { song: 30, tab: 120, theory: 60 }), id: 'x' }] }),
    ).toEqual(['scale', 'song', 'tab']);
    expect(autoDone(items, { ...base, sessions: [session(14, { song: 900, tab: 900, theory: 900 })] })).toEqual([]);
  });
});
