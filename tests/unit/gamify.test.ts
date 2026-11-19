import { afterEach, describe, expect, it } from 'vitest';
import type { TransitionResult } from '../../src/features/chords/transitions';
import {
  BADGE_GROUPS,
  RANKS,
  XP_SOURCES,
  badgeDates,
  badgeStates,
  BADGES,
  buildGameData,
  computeStats,
  dailyQuests,
  dataUntil,
  dayXp,
  diffNews,
  emptyData,
  gameSnapshot,
  groupByDay,
  levelInfo,
  QUEST_POOL,
  QUESTS,
  questStates,
  rankFor,
  totalXp,
  withActive,
  XP,
  xpDays,
  xpForLevel,
  xpHistory,
  xpTotalsBySource,
  type GameData,
  type QuestId,
  type Stats,
} from '../../src/features/gamify/logic';
import { addDays, type SessionRecord } from '../../src/features/log/stats';
import { en } from '../../src/i18n/en';
import { tr } from '../../src/i18n/tr';
import type { RhythmResult } from '../../src/features/rhythm/analysis';
import type { EarResult } from '../../src/music/ear';
import type { GameResult } from '../../src/music/fretboard';

// Tüm tarihler yerel saatle kurulur: testler hangi saat diliminde çalışırsa çalışsın aynı günlere düşer.
const at = (key: string, hour = 12, minute = 0) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, hour, minute).getTime();
};

let seq = 0;
const id = () => `r${++seq}`;

const session = (key: string, minutes: number, activities?: Record<string, number>, hour = 12): SessionRecord => ({
  id: id(),
  type: 'session',
  date: at(key, hour),
  seconds: minutes * 60,
  activities: activities ?? { free: minutes * 60 },
});

const transition = (key: string, count = 20, seconds = 60, a = 'C', b = 'G'): TransitionResult => ({
  id: id(),
  type: 'transition',
  date: at(key),
  a,
  b,
  pair: [a, b].sort().join('|'),
  count,
  seconds,
});

const rhythm = (key: string, accuracy: number, targets = 32): RhythmResult => ({
  id: id(),
  type: 'rhythm',
  date: at(key),
  bpm: 80,
  bars: 4,
  what: 'div:1',
  source: 'metronome',
  targets,
  hits: targets,
  missed: 0,
  extra: 0,
  meanMs: 0,
  absMs: 10,
  stdMs: 10,
  accuracy,
  consistency: 80,
  deviations: [],
});

const ear = (key: string, level: number, correct: number, kind: 'interval' | 'chord' = 'interval'): EarResult => ({
  id: id(),
  type: 'ear',
  date: at(key),
  kind,
  level,
  correct,
  total: 10,
  seconds: 40,
  items: {},
});

const fret = (key: string, correct: number): GameResult => ({
  id: id(),
  type: 'fretgame',
  date: at(key),
  mode: 'name',
  maxFret: 5,
  naturalsOnly: true,
  correct,
  total: 10,
  seconds: 30,
});

const content = (key: string) => ({ id: id(), date: at(key) });

const data = (patch: Partial<GameData>): GameData => ({ ...emptyData(), ...patch });

const TODAY = '2026-11-19';

/** `stats`'ın bir alanını değiştirip yalnızca o rozetin durumuna bakar. */
const zeroStats = (): Stats => computeStats(emptyData(), TODAY);
const earned = (id: string, patch: Partial<Stats>) =>
  badgeStates({ ...zeroStats(), ...patch }).find((b) => b.id === id)!.earned;

describe('seviye', () => {
  it('eşikler: 1→0, 2→100, 3→250, 4→450, 5→700', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([0, 100, 250, 450, 700]);
  });

  it('her seviye bir öncekinden 50 XP daha fazla ister', () => {
    for (let l = 1; l < 40; l++) {
      expect(xpForLevel(l + 1) - xpForLevel(l)).toBe(100 + 50 * (l - 1));
    }
  });

  it('XP → seviye, eşiklerde tam geçiş', () => {
    expect(levelInfo(0)).toMatchObject({ level: 1, into: 0, remaining: 100, progress: 0 });
    expect(levelInfo(99).level).toBe(1);
    expect(levelInfo(100)).toMatchObject({ level: 2, floor: 100, next: 250, into: 0, remaining: 150 });
    expect(levelInfo(175).progress).toBeCloseTo(0.5);
    expect(levelInfo(249).level).toBe(2);
    expect(levelInfo(250).level).toBe(3);
    expect(levelInfo(xpForLevel(25)).level).toBe(25);
    expect(levelInfo(xpForLevel(25) - 1).level).toBe(24);
  });

  it('negatif ya da kesirli XP güvenli', () => {
    expect(levelInfo(-50)).toMatchObject({ level: 1, xp: 0 });
    expect(levelInfo(100.9).xp).toBe(100);
  });

  it('unvanlar', () => {
    expect(rankFor(1)).toBe('novice');
    expect(rankFor(4)).toBe('novice');
    expect(rankFor(5)).toBe('apprentice');
    expect(rankFor(10)).toBe('journeyman');
    expect(rankFor(20)).toBe('master');
    expect(rankFor(31)).toBe('virtuoso');
  });
});

describe('veri', () => {
  it('ham kayıtları türlerine ayırır, bozukları ve hazır içerikleri atlar', () => {
    const d = buildGameData(
      [session(TODAY, 5), { id: 'x', type: 'session' }],
      [transition(TODAY), rhythm(TODAY, 90), ear(TODAY, 1, 9), fret(TODAY, 10), { type: 'rhythm' }, { type: 'strum' }],
      [
        { id: 'a', type: 'recording', date: at(TODAY) },
        { id: 'b', type: 'song', date: at(TODAY) },
        { id: 'c', type: 'tab', date: at(TODAY) },
        { id: 'd', type: 'tab', date: at(TODAY), builtin: true },
        { id: 'e', type: 'progression', date: at(TODAY) },
        { id: 'f', type: 'song' },
      ],
    );
    expect(d.sessions).toHaveLength(1);
    expect([d.transitions.length, d.rhythm.length, d.ear.length, d.fretgame.length]).toEqual([1, 1, 1, 1]);
    expect([d.recordings.length, d.songs.length, d.tabs.length]).toEqual([1, 1, 1]);
  });

  it('süren oturum tam saniyelerle eklenir; yoksa veri aynen döner', () => {
    const base = data({ sessions: [session(TODAY, 5)] });
    expect(withActive(base, null)).toBe(base);
    const live = withActive(base, {
      startedAt: at(TODAY, 15),
      seconds: 125.7,
      activities: { chords: 100.4, free: 25.3 },
      paused: false,
      lastTick: at(TODAY, 15),
    });
    expect(live.sessions).toHaveLength(2);
    expect(live.sessions[1]).toMatchObject({ id: 'active', seconds: 125, activities: { chords: 100, free: 25 } });
    expect(base.sessions).toHaveLength(1);
  });

  it('gün sınırı yerel saate göre: 23:59 o güne, 00:00 ertesi güne', () => {
    const d = data({
      sessions: [session(TODAY, 10, undefined, 0), { ...session(TODAY, 10), date: at(TODAY, 23, 59) }],
      transitions: [{ ...transition(TODAY), date: at(addDays(TODAY, 1), 0, 0) }],
    });
    const days = groupByDay(d);
    expect(days.get(TODAY)!.sessions).toHaveLength(2);
    expect(days.get(TODAY)!.transitions).toHaveLength(0);
    expect(days.get(addDays(TODAY, 1))!.transitions).toHaveLength(1);
    expect(dataUntil(d, TODAY).transitions).toHaveLength(0);
  });
});

describe('günlük görevler', () => {
  const keys = Array.from({ length: 120 }, (_, i) => addDays('2026-01-01', i));

  it('her gün 3 görev: ilki süre görevi, diğerleri havuzdan ve farklı ailelerden', () => {
    for (const key of keys) {
      const q = dailyQuests(key);
      expect(q).toHaveLength(3);
      expect(['practice15', 'practice30']).toContain(q[0]);
      for (const x of q.slice(1)) expect(QUEST_POOL).toContain(x);
      expect(new Set(q.map((x) => QUESTS[x].family)).size).toBe(3);
    }
  });

  it('aynı gün hep aynı görevler; günden güne değişir ve havuzun tamamı kullanılır', () => {
    expect(dailyQuests(TODAY)).toEqual(dailyQuests(TODAY));
    const sets = keys.map((k) => dailyQuests(k).join(','));
    expect(new Set(sets).size).toBeGreaterThan(20);
    const used = new Set(keys.flatMap((k) => dailyQuests(k)));
    for (const x of QUEST_POOL) expect(used.has(x)).toBe(true);
  });

  it('30 dakikalık görev her üç günde bir', () => {
    const long = keys.filter((k) => dailyQuests(k)[0] === 'practice30').length;
    expect(long).toBe(40);
    expect(dailyQuests('2026-11-19')[0]).toBe('practice15');
    expect(dailyQuests('2026-11-21')[0]).toBe('practice30');
  });

  it('seçim saat diliminden bağımsız', () => {
    const before = keys.map(dailyQuests);
    const tz = process.env.TZ;
    try {
      for (const zone of ['Pacific/Auckland', 'America/Los_Angeles', 'Europe/Istanbul']) {
        process.env.TZ = zone;
        expect(keys.map(dailyQuests)).toEqual(before);
      }
    } finally {
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });

  const progress = (quest: QuestId, d: GameData) => QUESTS[quest].progress(d);

  it('her görevin ilerlemesi o günün verisinden', () => {
    expect(progress('practice15', data({ sessions: [session(TODAY, 9), session(TODAY, 6)] }))).toBe(15);
    expect(progress('practice30', data({ sessions: [{ ...session(TODAY, 0), seconds: 1799 }] }))).toBe(29);
    expect(progress('transition', data({ transitions: [transition(TODAY)] }))).toBe(1);
    expect(progress('transition3', data({ transitions: [transition(TODAY), transition(TODAY)] }))).toBe(2);
    expect(progress('rhythm', data({ rhythm: [rhythm(TODAY, 10)] }))).toBe(1);
    expect(progress('rhythmGood', data({ rhythm: [rhythm(TODAY, 60), rhythm(TODAY, 77)] }))).toBe(77);
    // Kısa ölçümler (16 hedef vuruştan az) "iyi ritim" sayılmaz.
    expect(progress('rhythmGood', data({ rhythm: [rhythm(TODAY, 100, 8)] }))).toBe(0);
    expect(progress('ear2', data({ ear: [ear(TODAY, 1, 3), ear(TODAY, 1, 9)] }))).toBe(2);
    expect(progress('fretgame', data({ fretgame: [fret(TODAY, 2)] }))).toBe(1);
    expect(progress('record', data({ recordings: [content(TODAY)] }))).toBe(1);
    expect(
      progress('song10', data({ sessions: [session(TODAY, 12, { song: 400, free: 320 }), session(TODAY, 4, { song: 240 })] })),
    ).toBe(10);
  });

  it('çeşitlilik: serbest çalışma hariç, en az bir dakika çalışılan türler', () => {
    const d = data({
      sessions: [session(TODAY, 10, { free: 300, chords: 60, ear: 59, rhythm: 30 }), session(TODAY, 2, { rhythm: 30, theory: 90 })],
    });
    expect(progress('variety', d)).toBe(3);
  });

  it('tamamlanma: değer hedefe ulaşınca', () => {
    const quests = dailyQuests(TODAY);
    const full = data({
      sessions: [session(TODAY, 40, { chords: 600, song: 900, rhythm: 600, free: 300 })],
      transitions: [transition(TODAY), transition(TODAY), transition(TODAY)],
      rhythm: [rhythm(TODAY, 90)],
      ear: [ear(TODAY, 1, 9), ear(TODAY, 1, 9)],
      fretgame: [fret(TODAY, 10)],
      recordings: [content(TODAY)],
    });
    expect(questStates(TODAY, full).every((q) => q.done)).toBe(true);
    const none = questStates(TODAY, emptyData());
    expect(none.map((q) => q.id)).toEqual(quests);
    expect(none.every((q) => !q.done && q.value === 0)).toBe(true);
  });
});

describe('XP', () => {
  it('çalışma: dakika başına 1, en az bir dakikalık gün için +10', () => {
    expect(dayXp(TODAY, data({ sessions: [{ ...session(TODAY, 0), seconds: 59 }] })).bySource.practice).toBe(0);
    expect(dayXp(TODAY, data({ sessions: [{ ...session(TODAY, 0), seconds: 60 }] })).bySource.practice).toBe(11);
    expect(dayXp(TODAY, data({ sessions: [session(TODAY, 7), { ...session(TODAY, 0), seconds: 90 }] })).bySource.practice).toBe(
      8 + XP.practiceDay,
    );
  });

  it('egzersizler ve ekleri', () => {
    const d = data({
      transitions: [transition(TODAY)],
      rhythm: [rhythm(TODAY, 79), rhythm(TODAY, 80), rhythm(TODAY, 99, 8)],
      ear: [ear(TODAY, 1, 7), ear(TODAY, 1, 8)],
      fretgame: [fret(TODAY, 9), fret(TODAY, 10)],
    });
    const expected =
      XP.transition + 3 * XP.rhythm + XP.rhythmGood + 2 * XP.ear + XP.earPass + 2 * XP.fretgame + XP.fretPerfect;
    expect(dayXp(TODAY, d).bySource.exercise).toBe(expected);
  });

  it('içerik: kayıt 5, şarkı 10, tab 10', () => {
    const d = data({ recordings: [content(TODAY)], songs: [content(TODAY)], tabs: [content(TODAY), content(TODAY)] });
    expect(dayXp(TODAY, d).bySource.content).toBe(35);
  });

  it('görevler: her biri 20, üçü birden +20', () => {
    const [first] = dailyQuests(TODAY);
    const target = QUESTS[first].target;
    const one = dayXp(TODAY, data({ sessions: [session(TODAY, target, { free: target * 60 })] }));
    expect(one.questsDone).toBe(1);
    expect(one.bySource.quest).toBe(XP.quest);
    const all = dayXp(
      TODAY,
      data({
        sessions: [session(TODAY, 40, { chords: 600, song: 900, rhythm: 600, free: 300 })],
        transitions: [transition(TODAY), transition(TODAY), transition(TODAY)],
        rhythm: [rhythm(TODAY, 90)],
        ear: [ear(TODAY, 1, 9), ear(TODAY, 1, 9)],
        fretgame: [fret(TODAY, 10)],
        recordings: [content(TODAY)],
      }),
    );
    expect(all.questsDone).toBe(3);
    expect(all.bySource.quest).toBe(3 * XP.quest + XP.allQuests);
  });

  it('günlere bölünür; toplam ve kaynak toplamları tutarlı; geçmiş boş günleri 0 sayar', () => {
    const y = addDays(TODAY, -1);
    const d = data({ sessions: [session(y, 5), session(TODAY, 5)], transitions: [transition(y)] });
    const days = xpDays(d);
    expect(days.map((x) => x.key)).toEqual([y, TODAY]);
    const total = totalXp(days);
    const src = xpTotalsBySource(days);
    expect(src.practice + src.exercise + src.quest + src.content).toBe(total);
    expect(src.exercise).toBe(XP.transition);
    const hist = xpHistory(days, TODAY, 7);
    expect(hist).toHaveLength(7);
    expect(hist[6].key).toBe(TODAY);
    expect(hist[0].xp).toBe(0);
    expect(hist[5].xp + hist[6].xp).toBe(total);
  });

  it('XP veriden türetilir: aynı veri, aynı sonuç (dışa/içe aktarma sonrası da)', () => {
    const d = data({ sessions: [session(TODAY, 20)], rhythm: [rhythm(TODAY, 85)], songs: [content(TODAY)] });
    const copy = buildGameData(
      JSON.parse(JSON.stringify(d.sessions)),
      JSON.parse(JSON.stringify(d.rhythm)),
      JSON.parse(JSON.stringify(d.songs.map((s) => ({ ...s, type: 'song' })))),
    );
    expect(totalXp(xpDays(copy))).toBe(totalXp(xpDays(d)));
  });
});

describe('rozetler', () => {
  it('25 rozet, kimlikler benzersiz', () => {
    expect(BADGES).toHaveLength(25);
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(25);
  });

  it('boş veride hiçbiri kazanılmamış', () => {
    expect(badgeStates(zeroStats()).filter((b) => b.earned)).toEqual([]);
  });

  it.each([
    ['firstSession', { sessions: 1 }, { sessions: 0 }],
    ['streak3', { longestStreak: 3 }, { longestStreak: 2 }],
    ['streak7', { longestStreak: 7 }, { longestStreak: 6 }],
    ['streak30', { longestStreak: 30 }, { longestStreak: 29 }],
    ['hours1', { totalMinutes: 60 }, { totalMinutes: 59 }],
    ['hours10', { totalMinutes: 600 }, { totalMinutes: 599 }],
    ['hours50', { totalMinutes: 3000 }, { totalMinutes: 2999 }],
    ['explorer', { activities: 5 }, { activities: 4 }],
    ['txFirst', { transitions: 1 }, { transitions: 0 }],
    ['tx30', { bestPerMinute: 30 }, { bestPerMinute: 29 }],
    ['tx60', { bestPerMinute: 60 }, { bestPerMinute: 59 }],
    ['txPairs', { pairs: 5 }, { pairs: 4 }],
    ['rhythmFirst', { rhythm: 1 }, { rhythm: 0 }],
    ['rhythm80', { bestRhythm: 80 }, { bestRhythm: 79 }],
    ['rhythm95', { bestRhythm: 95 }, { bestRhythm: 94 }],
    ['earFirst', { ear: 1 }, { ear: 0 }],
    ['earLevel4', { earUnlocked: 4 }, { earUnlocked: 3 }],
    ['earMaster', { earPassed: 6 }, { earPassed: 5 }],
    ['fretFirst', { fretgame: 1 }, { fretgame: 0 }],
    ['fretPerfect', { fretPerfect: 1 }, { fretPerfect: 0 }],
    ['recordFirst', { recordings: 1 }, { recordings: 0 }],
    ['songFirst', { songs: 1 }, { songs: 0 }],
    ['tabFirst', { tabs: 1 }, { tabs: 0 }],
    ['perfectDay', { perfectDays: 1 }, { perfectDays: 0 }],
    ['quests25', { questsDone: 25 }, { questsDone: 24 }],
  ] as [string, Partial<Stats>, Partial<Stats>][])('%s: eşikte kazanılır, altında kazanılmaz', (badgeId, yes, no) => {
    expect(earned(badgeId, yes)).toBe(true);
    expect(earned(badgeId, no)).toBe(false);
  });

  it('her rozet bir kuralla sınanıyor', () => {
    // Yukarıdaki tablo BADGES ile aynı uzunlukta olmalı (yeni rozet eklenince test de eklensin).
    expect(BADGES.map((b) => b.id).sort()).toEqual(
      [
        'firstSession', 'streak3', 'streak7', 'streak30', 'hours1', 'hours10', 'hours50', 'explorer',
        'txFirst', 'tx30', 'tx60', 'txPairs', 'rhythmFirst', 'rhythm80', 'rhythm95', 'earFirst', 'earLevel4',
        'earMaster', 'fretFirst', 'fretPerfect', 'recordFirst', 'songFirst', 'tabFirst', 'perfectDay', 'quests25',
      ].sort(),
    );
  });

  it('istatistikler veriden doğru hesaplanır', () => {
    const days = [0, 1, 2, 3].map((i) => addDays(TODAY, -i));
    const d = data({
      sessions: [
        ...days.map((k) => session(k, 20, { chords: 600, free: 600 })),
        session(addDays(TODAY, -10), 30, { ear: 600, theory: 600, rhythm: 300, song: 300 }),
      ],
      transitions: [transition(TODAY, 31, 60, 'C', 'G'), transition(TODAY, 10, 30, 'Am', 'C'), transition(TODAY, 5, 60, 'G', 'C')],
      rhythm: [rhythm(TODAY, 82), rhythm(TODAY, 99, 8)],
      ear: [1, 2, 3].map((level) => ear(TODAY, level, 8)),
      fretgame: [fret(TODAY, 10), fret(TODAY, 9)],
    });
    const s = computeStats(d, TODAY);
    expect(s).toMatchObject({
      sessions: 5,
      totalMinutes: 110,
      longestStreak: 4,
      activities: 5,
      transitions: 3,
      bestPerMinute: 31,
      pairs: 2,
      rhythm: 2,
      bestRhythm: 82,
      ear: 3,
      earUnlocked: 4,
      earPassed: 3,
      fretgame: 2,
      fretPerfect: 1,
    });
    const states = badgeStates(s);
    const got = states.filter((b) => b.earned).map((b) => b.id);
    expect(got).toEqual(
      expect.arrayContaining(['firstSession', 'streak3', 'hours1', 'explorer', 'txFirst', 'tx30', 'rhythm80', 'earLevel4', 'fretPerfect']),
    );
    expect(got).not.toContain('streak7');
    expect(got).not.toContain('rhythm95');
    expect(states.find((b) => b.id === 'streak7')).toMatchObject({ value: 4, target: 7 });
    expect(states.find((b) => b.id === 'streak7')!.progress).toBeCloseTo(4 / 7);
  });

  it('kulak eğitiminde geçilmeyen tur seviye açmaz; türler ayrı sayılır', () => {
    const d = data({ ear: [ear(TODAY, 1, 7), ear(TODAY, 1, 9, 'chord'), ear(TODAY, 2, 8, 'chord')] });
    const s = computeStats(d, TODAY);
    expect(s.earUnlocked).toBe(3);
    expect(s.earPassed).toBe(2);
  });

  it('kazanılma günü: kuralın ilk sağlandığı gün', () => {
    const k = (n: number) => addDays(TODAY, -n);
    const d = data({
      sessions: [session(k(5), 5), session(k(4), 5), session(k(3), 5), session(k(1), 70)],
      transitions: [transition(k(4), 10), transition(k(2), 40)],
    });
    const dates = badgeDates(d, TODAY);
    expect(dates.get('firstSession')).toBe(k(5));
    expect(dates.get('streak3')).toBe(k(3));
    expect(dates.get('txFirst')).toBe(k(4));
    expect(dates.get('tx30')).toBe(k(2));
    expect(dates.get('hours1')).toBe(k(1));
    expect(dates.has('streak7')).toBe(false);
  });
});

describe('metinler', () => {
  it('her rozet, görev, unvan, grup ve kaynak için TR ve EN metni var', () => {
    const keys = [
      ...BADGES.flatMap((b) => [`gamify.badge.${b.id}`, `gamify.badge.${b.id}.desc`]),
      ...Object.keys(QUESTS).map((q) => `gamify.quest.${q}`),
      ...RANKS.map((r) => `gamify.rank.${r.id}`),
      ...BADGE_GROUPS.map((g) => `gamify.group.${g}`),
      ...XP_SOURCES.map((s) => `gamify.source.${s}`),
    ];
    for (const dict of [tr, en] as Record<string, string>[]) {
      const missing = keys.filter((k) => !dict[k]);
      expect(missing).toEqual([]);
    }
  });
});

describe('özet ve bildirimler', () => {
  afterEach(() => {
    seq = 0;
  });

  it('özet: XP, seviye, bugünün XP\'si, seri; gelecekteki kayıtlar sayılmaz', () => {
    const d = data({
      sessions: [session(addDays(TODAY, -1), 30), session(TODAY, 20), session(addDays(TODAY, 1), 500)],
    });
    const snap = gameSnapshot(d, TODAY);
    expect(snap.days.map((x) => x.key)).toEqual([addDays(TODAY, -1), TODAY]);
    expect(snap.todayXp).toBe(snap.days[1].xp);
    expect(snap.xp).toBe(snap.days[0].xp + snap.days[1].xp);
    expect(snap.level.level).toBe(levelInfo(snap.xp).level);
    expect(snap.streak).toBe(2);
    expect(snap.quests).toHaveLength(3);
    expect(snap.badges).toHaveLength(BADGES.length);
  });

  it('yalnızca daha önce görülmemiş rozet ve görevler yeni sayılır', () => {
    const [first] = dailyQuests(TODAY);
    const snap = gameSnapshot(
      data({ sessions: [session(TODAY, 31)], transitions: [transition(TODAY)] }),
      TODAY,
    );
    const news = diffNews(snap, [], []);
    expect(news.badges).toEqual(expect.arrayContaining(['firstSession', 'txFirst']));
    expect(news.quests).toContain(first);
    expect(diffNews(snap, news.badges, news.quests)).toEqual({ badges: [], quests: [] });
  });
});
