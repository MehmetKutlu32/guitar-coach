/**
 * Oyunlaştırma (Aşama 15) için saf hesaplar: XP, seviye, rozetler, günlük görevler.
 *
 * Hiçbir şey ayrıca saklanmaz: hepsi kayıtlı veriden (günlük oturumları, egzersiz sonuçları, kullanıcı
 * içerikleri) türetilir. Böylece JSON dışa/içe aktarma ve geçmiş veriler kendiliğinden doğru sonuç verir.
 * Gün sınırları yerel saate göredir (`dayKey`), pratik günlüğüyle aynı.
 */
import { mulberry32 } from '../../audio/synth/karplus';
import type { IconName } from '../../ui/Icon';
import { isTransitionResult, perMinute, type TransitionResult } from '../chords/transitions';
import {
  addDays,
  dayKey,
  isSessionRecord,
  MIN_DAY_SECONDS,
  streaks,
  type ActiveSession,
  type SessionRecord,
} from '../log/stats';
import { dayIndex } from '../plan/generator';
import { isRhythmResult, type RhythmResult } from '../rhythm/analysis';
import { earLevels, isEarResult, isPass, type EarKind, type EarResult } from '../../music/ear';
import { gameScore, isGameResult, type GameResult } from '../../music/fretboard';

// ---------------------------------------------------------------------------------------------
// Veri

/** Kullanıcının oluşturduğu içerik (kayıt, şarkı, tab): yalnızca kimlik ve tarih gerekir. */
export interface ContentItem {
  id: string;
  date: number;
}

export interface GameData {
  sessions: SessionRecord[];
  transitions: TransitionResult[];
  rhythm: RhythmResult[];
  ear: EarResult[];
  fretgame: GameResult[];
  recordings: ContentItem[];
  songs: ContentItem[];
  tabs: ContentItem[];
}

export function emptyData(): GameData {
  return { sessions: [], transitions: [], rhythm: [], ear: [], fretgame: [], recordings: [], songs: [], tabs: [] };
}

const FIELDS = Object.keys(emptyData()) as (keyof GameData)[];

function contentOf(items: unknown[], type: string): ContentItem[] {
  const out: ContentItem[] = [];
  for (const v of items) {
    if (!v || typeof v !== 'object') continue;
    const r = v as { id?: unknown; type?: unknown; date?: unknown; builtin?: unknown };
    if (r.type !== type || typeof r.id !== 'string' || typeof r.date !== 'number' || r.builtin) continue;
    out.push({ id: r.id, date: r.date });
  }
  return out;
}

/** Depolardan okunan ham kayıtları türlerine ayırır; bozuk kayıtları atlar. */
export function buildGameData(sessions: unknown[], results: unknown[], items: unknown[]): GameData {
  return {
    sessions: sessions.filter(isSessionRecord),
    transitions: results.filter(isTransitionResult),
    rhythm: results.filter(isRhythmResult),
    ear: results.filter(isEarResult),
    fretgame: results.filter(isGameResult),
    recordings: contentOf(items, 'recording'),
    songs: contentOf(items, 'song'),
    tabs: contentOf(items, 'tab'),
  };
}

/** Süren (henüz kaydedilmemiş) oturumu da hesaba katar; ekrandaki ilerleme canlı görünsün diye. */
export function withActive(data: GameData, active: ActiveSession | null): GameData {
  if (!active || active.seconds < 1) return data;
  const activities: Record<string, number> = {};
  for (const [a, sec] of Object.entries(active.activities)) activities[a] = Math.floor(sec);
  const live: SessionRecord = {
    id: 'active',
    type: 'session',
    date: active.startedAt,
    seconds: Math.floor(active.seconds),
    activities,
  };
  return { ...data, sessions: [...data.sessions, live] };
}

/** Verinin `lastKey` gününe kadar (dahil) olan kısmı. */
export function dataUntil(data: GameData, lastKey: string): GameData {
  const keep = <T extends { date: number }>(rows: T[]) => rows.filter((r) => dayKey(r.date) <= lastKey);
  return {
    sessions: keep(data.sessions),
    transitions: keep(data.transitions),
    rhythm: keep(data.rhythm),
    ear: keep(data.ear),
    fretgame: keep(data.fretgame),
    recordings: keep(data.recordings),
    songs: keep(data.songs),
    tabs: keep(data.tabs),
  };
}

/** Kayıtları günlere ayırır (yerel saat). */
export function groupByDay(data: GameData): Map<string, GameData> {
  const days = new Map<string, GameData>();
  const add = <K extends keyof GameData>(field: K, rows: GameData[K]) => {
    for (const row of rows) {
      const key = dayKey(row.date);
      let day = days.get(key);
      if (!day) {
        day = emptyData();
        days.set(key, day);
      }
      (day[field] as (typeof row)[]).push(row);
    }
  };
  FIELDS.forEach((f) => add(f, data[f]));
  return days;
}

// ---------------------------------------------------------------------------------------------
// Günlük görevler

export type QuestId =
  | 'practice15'
  | 'practice30'
  | 'transition'
  | 'transition3'
  | 'rhythm'
  | 'rhythmGood'
  | 'ear2'
  | 'fretgame'
  | 'variety'
  | 'record'
  | 'song10';

export type QuestUnit = 'min' | 'count' | 'percent';

export interface QuestDef {
  id: QuestId;
  icon: IconName;
  /** Aynı aileden iki görev aynı gün çıkmaz. */
  family: string;
  target: number;
  unit: QuestUnit;
  /** O günün verisinden ilerleme. */
  progress(day: GameData): number;
}

const daySeconds = (day: GameData) => day.sessions.reduce((s, x) => s + x.seconds, 0);
const activitySeconds = (day: GameData, activity: string) =>
  day.sessions.reduce((s, x) => s + (x.activities[activity] ?? 0), 0);
const minutes = (seconds: number) => Math.floor(seconds / 60);

/** Ritim ölçümü, bu kadar hedef vuruştan azsa "iyi ritim" sayılmaz (kısa denemelerle kolayca kazanılmasın). */
export const RHYTHM_MIN_TARGETS = 16;
const goodRhythm = (r: RhythmResult) => (r.targets >= RHYTHM_MIN_TARGETS ? r.accuracy : 0);
const maxOf = (values: number[]) => values.reduce((m, v) => Math.max(m, v), 0);

/** "Serbest çalışma" dışındaki, en az bir dakika çalışılan egzersiz türleri. */
function activitiesPracticed(sessions: SessionRecord[], minSeconds: number): Set<string> {
  const totals = new Map<string, number>();
  for (const s of sessions) {
    for (const [a, sec] of Object.entries(s.activities)) totals.set(a, (totals.get(a) ?? 0) + sec);
  }
  return new Set([...totals].filter(([a, sec]) => a !== 'free' && sec >= minSeconds).map(([a]) => a));
}

export const QUESTS: Record<QuestId, QuestDef> = {
  practice15: { id: 'practice15', icon: 'timer', family: 'time', target: 15, unit: 'min', progress: (d) => minutes(daySeconds(d)) },
  practice30: { id: 'practice30', icon: 'timer', family: 'time', target: 30, unit: 'min', progress: (d) => minutes(daySeconds(d)) },
  transition: { id: 'transition', icon: 'chords', family: 'chords', target: 1, unit: 'count', progress: (d) => d.transitions.length },
  transition3: { id: 'transition3', icon: 'chords', family: 'chords', target: 3, unit: 'count', progress: (d) => d.transitions.length },
  rhythm: { id: 'rhythm', icon: 'rhythm', family: 'rhythm', target: 1, unit: 'count', progress: (d) => d.rhythm.length },
  rhythmGood: {
    id: 'rhythmGood',
    icon: 'rhythm',
    family: 'rhythm',
    target: 75,
    unit: 'percent',
    progress: (d) => maxOf(d.rhythm.map(goodRhythm)),
  },
  ear2: { id: 'ear2', icon: 'ear', family: 'ear', target: 2, unit: 'count', progress: (d) => d.ear.length },
  fretgame: { id: 'fretgame', icon: 'fretboard', family: 'theory', target: 1, unit: 'count', progress: (d) => d.fretgame.length },
  variety: {
    id: 'variety',
    icon: 'plan',
    family: 'variety',
    target: 3,
    unit: 'count',
    progress: (d) => activitiesPracticed(d.sessions, 60).size,
  },
  record: { id: 'record', icon: 'record', family: 'record', target: 1, unit: 'count', progress: (d) => d.recordings.length },
  song10: { id: 'song10', icon: 'song', family: 'song', target: 10, unit: 'min', progress: (d) => minutes(activitySeconds(d, 'song')) },
};

/** İkinci ve üçüncü görevin seçildiği havuz (birincisi hep süre görevidir). */
export const QUEST_POOL: QuestId[] = [
  'transition',
  'transition3',
  'rhythm',
  'rhythmGood',
  'ear2',
  'fretgame',
  'variety',
  'record',
  'song10',
];

export const QUESTS_PER_DAY = 3;

/**
 * O günün üç görevi. Yalnızca gün anahtarına bağlıdır (saat dilimi ve saatten bağımsız):
 * birincisi süre görevi (her üç günde bir 30 dk, diğer günler 15 dk), diğer ikisi havuzdan, farklı ailelerden.
 */
export function dailyQuests(key: string): QuestId[] {
  const index = dayIndex(key);
  const first: QuestId = index % 3 === 0 ? 'practice30' : 'practice15';
  // Aynı gün her cihazda aynı görevler: gün numarasıyla tohumlanan karıştırma.
  const random = mulberry32(index * 2654435761);
  const pool = [...QUEST_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const out: QuestId[] = [first];
  const families = new Set([QUESTS[first].family]);
  for (const id of pool) {
    if (out.length >= QUESTS_PER_DAY) break;
    if (families.has(QUESTS[id].family)) continue;
    families.add(QUESTS[id].family);
    out.push(id);
  }
  return out;
}

export interface QuestState {
  id: QuestId;
  value: number;
  target: number;
  done: boolean;
}

export function questStates(key: string, day: GameData): QuestState[] {
  return dailyQuests(key).map((id) => {
    const q = QUESTS[id];
    const value = q.progress(day);
    return { id, value, target: q.target, done: value >= q.target };
  });
}

// ---------------------------------------------------------------------------------------------
// XP ve seviye

export const XP = {
  /** Çalışılan her dakika. */
  perMinute: 1,
  /** En az bir dakika çalışılan her gün. */
  practiceDay: 10,
  transition: 5,
  rhythm: 5,
  /** Ritim ölçümünde %80 ve üstü doğruluk için ek. */
  rhythmGood: 5,
  ear: 5,
  /** Kulak eğitiminde seviyeyi geçen tur için ek. */
  earPass: 5,
  fretgame: 5,
  /** Sap oyununda hatasız tur için ek. */
  fretPerfect: 5,
  recording: 5,
  song: 10,
  tab: 10,
  quest: 20,
  /** Günün üç görevi de tamamlanınca ek. */
  allQuests: 20,
} as const;

export type XpSource = 'practice' | 'exercise' | 'quest' | 'content';
export const XP_SOURCES: XpSource[] = ['practice', 'exercise', 'quest', 'content'];

export type XpBySource = Record<XpSource, number>;

export interface DayXp {
  key: string;
  xp: number;
  bySource: XpBySource;
  questsDone: number;
}

const zeroSources = (): XpBySource => ({ practice: 0, exercise: 0, quest: 0, content: 0 });

/** Tek bir günün XP'si (o günün verisinden). */
export function dayXp(key: string, day: GameData): DayXp {
  const bySource = zeroSources();
  const seconds = daySeconds(day);
  bySource.practice = Math.floor(seconds / 60) * XP.perMinute + (seconds >= MIN_DAY_SECONDS ? XP.practiceDay : 0);

  let exercise = day.transitions.length * XP.transition;
  for (const r of day.rhythm) exercise += XP.rhythm + (goodRhythm(r) >= 80 ? XP.rhythmGood : 0);
  for (const r of day.ear) exercise += XP.ear + (isPass(r) ? XP.earPass : 0);
  for (const r of day.fretgame) exercise += XP.fretgame + (r.total >= 10 && r.correct === r.total ? XP.fretPerfect : 0);
  bySource.exercise = exercise;

  bySource.content = day.recordings.length * XP.recording + day.songs.length * XP.song + day.tabs.length * XP.tab;

  const questsDone = questStates(key, day).filter((q) => q.done).length;
  bySource.quest = questsDone * XP.quest + (questsDone === QUESTS_PER_DAY ? XP.allQuests : 0);

  const xp = XP_SOURCES.reduce((s, src) => s + bySource[src], 0);
  return { key, xp, bySource, questsDone };
}

/** Verinin olduğu her günün XP'si, eskiden yeniye. */
export function xpDays(data: GameData): DayXp[] {
  return [...groupByDay(data)]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, day]) => dayXp(key, day));
}

export function totalXp(days: DayXp[]): number {
  return days.reduce((s, d) => s + d.xp, 0);
}

export function xpTotalsBySource(days: DayXp[]): XpBySource {
  const out = zeroSources();
  for (const d of days) for (const src of XP_SOURCES) out[src] += d.bySource[src];
  return out;
}

/** `todayKey` ile biten son `n` günün XP'si (veri olmayan günler 0), eskiden yeniye. */
export function xpHistory(days: DayXp[], todayKey: string, n: number): { key: string; xp: number }[] {
  const byKey = new Map(days.map((d) => [d.key, d.xp]));
  const out: { key: string; xp: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = addDays(todayKey, -i);
    out.push({ key, xp: byKey.get(key) ?? 0 });
  }
  return out;
}

/**
 * `level` seviyesine ulaşmak için gereken toplam XP. Seviye 1 → 0 XP.
 * Seviye L'den L+1'e geçiş 100 + 50·(L−1) XP ister: 100, 150, 200, …
 */
export function xpForLevel(level: number): number {
  const n = Math.max(0, Math.floor(level) - 1);
  return 100 * n + 25 * n * (n - 1);
}

export interface LevelInfo {
  level: number;
  xp: number;
  /** Bu seviyenin başladığı toplam XP. */
  floor: number;
  /** Sonraki seviyenin başladığı toplam XP. */
  next: number;
  /** Bu seviyede kazanılan XP. */
  into: number;
  /** Sonraki seviyeye kalan XP. */
  remaining: number;
  /** 0..1 */
  progress: number;
}

export function levelInfo(xp: number): LevelInfo {
  const total = Math.max(0, Math.floor(xp));
  let level = 1;
  while (xpForLevel(level + 1) <= total) level++;
  const floor = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    level,
    xp: total,
    floor,
    next,
    into: total - floor,
    remaining: next - total,
    progress: (total - floor) / (next - floor),
  };
}

/** Seviye unvanları: bu seviyeden itibaren. */
export const RANKS = [
  { id: 'novice', from: 1 },
  { id: 'apprentice', from: 5 },
  { id: 'journeyman', from: 10 },
  { id: 'master', from: 20 },
  { id: 'virtuoso', from: 30 },
] as const;
export type RankId = (typeof RANKS)[number]['id'];

export function rankFor(level: number): RankId {
  let rank: RankId = RANKS[0].id;
  for (const r of RANKS) if (level >= r.from) rank = r.id;
  return rank;
}

// ---------------------------------------------------------------------------------------------
// Rozetler

/** Rozet kurallarının baktığı birikimli değerler. */
export interface Stats {
  sessions: number;
  totalMinutes: number;
  longestStreak: number;
  activities: number;
  transitions: number;
  bestPerMinute: number;
  pairs: number;
  rhythm: number;
  bestRhythm: number;
  ear: number;
  /** Herhangi bir türde açılmış en yüksek kulak eğitimi seviyesi. */
  earUnlocked: number;
  /** Bir türde geçilen en çok seviye sayısı. */
  earPassed: number;
  fretgame: number;
  fretPerfect: number;
  recordings: number;
  songs: number;
  tabs: number;
  questsDone: number;
  perfectDays: number;
}

function earProgress(results: EarResult[]): { unlocked: number; passed: number } {
  let unlocked = 0;
  let passed = 0;
  for (const kind of ['interval', 'chord'] as EarKind[]) {
    const levels = earLevels(kind).length;
    const ok = new Set(results.filter((r) => r.kind === kind && isPass(r)).map((r) => r.level));
    let level = 1;
    while (level < levels && ok.has(level)) level++;
    unlocked = Math.max(unlocked, level);
    let count = 0;
    for (let l = 1; l <= levels; l++) if (ok.has(l)) count++;
    passed = Math.max(passed, count);
  }
  return { unlocked, passed };
}

/** `todayKey` gününe kadarki veriden rozet değerleri. `days`, aynı verinin `xpDays` sonucu. */
export function computeStats(data: GameData, todayKey: string, days: DayXp[] = xpDays(data)): Stats {
  const ear = earProgress(data.ear);
  return {
    sessions: data.sessions.length,
    totalMinutes: Math.floor(data.sessions.reduce((s, x) => s + x.seconds, 0) / 60),
    longestStreak: streaks(data.sessions, todayKey).longest,
    activities: activitiesPracticed(data.sessions, 60).size,
    transitions: data.transitions.length,
    bestPerMinute: maxOf(data.transitions.map(perMinute)),
    pairs: new Set(data.transitions.map((r) => r.pair)).size,
    rhythm: data.rhythm.length,
    bestRhythm: maxOf(data.rhythm.map(goodRhythm)),
    ear: data.ear.length,
    earUnlocked: ear.unlocked,
    earPassed: ear.passed,
    fretgame: data.fretgame.length,
    fretPerfect: data.fretgame.filter((r) => r.total >= 10 && gameScore(r.correct, r.total) === 100).length,
    recordings: data.recordings.length,
    songs: data.songs.length,
    tabs: data.tabs.length,
    questsDone: days.reduce((s, d) => s + d.questsDone, 0),
    perfectDays: days.filter((d) => d.questsDone === QUESTS_PER_DAY).length,
  };
}

export type BadgeGroup = 'practice' | 'chords' | 'rhythm' | 'ear' | 'theory' | 'create' | 'quests';
export const BADGE_GROUPS: BadgeGroup[] = ['practice', 'chords', 'rhythm', 'ear', 'theory', 'create', 'quests'];

export interface BadgeDef {
  id: string;
  group: BadgeGroup;
  icon: IconName;
  target: number;
  /** İlerlemenin gösterim birimi. */
  unit: QuestUnit;
  value(s: Stats): number;
}

const badge = (
  id: string,
  group: BadgeGroup,
  icon: IconName,
  target: number,
  value: (s: Stats) => number,
  unit: QuestUnit = 'count',
): BadgeDef => ({ id, group, icon, target, unit, value });

export const BADGES: BadgeDef[] = [
  badge('firstSession', 'practice', 'timer', 1, (s) => s.sessions),
  badge('streak3', 'practice', 'log', 3, (s) => s.longestStreak),
  badge('streak7', 'practice', 'log', 7, (s) => s.longestStreak),
  badge('streak30', 'practice', 'log', 30, (s) => s.longestStreak),
  badge('hours1', 'practice', 'timer', 60, (s) => s.totalMinutes, 'min'),
  badge('hours10', 'practice', 'timer', 600, (s) => s.totalMinutes, 'min'),
  badge('hours50', 'practice', 'timer', 3000, (s) => s.totalMinutes, 'min'),
  badge('explorer', 'practice', 'plan', 5, (s) => s.activities),
  badge('txFirst', 'chords', 'chords', 1, (s) => s.transitions),
  badge('tx30', 'chords', 'chords', 30, (s) => s.bestPerMinute),
  badge('tx60', 'chords', 'chords', 60, (s) => s.bestPerMinute),
  badge('txPairs', 'chords', 'chords', 5, (s) => s.pairs),
  badge('rhythmFirst', 'rhythm', 'rhythm', 1, (s) => s.rhythm),
  badge('rhythm80', 'rhythm', 'rhythm', 80, (s) => s.bestRhythm, 'percent'),
  badge('rhythm95', 'rhythm', 'rhythm', 95, (s) => s.bestRhythm, 'percent'),
  badge('earFirst', 'ear', 'ear', 1, (s) => s.ear),
  badge('earLevel4', 'ear', 'ear', 4, (s) => s.earUnlocked),
  badge('earMaster', 'ear', 'ear', earLevels('interval').length, (s) => s.earPassed),
  badge('fretFirst', 'theory', 'fretboard', 1, (s) => s.fretgame),
  badge('fretPerfect', 'theory', 'fretboard', 1, (s) => s.fretPerfect),
  badge('recordFirst', 'create', 'record', 1, (s) => s.recordings),
  badge('songFirst', 'create', 'song', 1, (s) => s.songs),
  badge('tabFirst', 'create', 'tab', 1, (s) => s.tabs),
  badge('perfectDay', 'quests', 'trophy', 1, (s) => s.perfectDays),
  badge('quests25', 'quests', 'trophy', 25, (s) => s.questsDone),
];

export interface BadgeState {
  id: string;
  value: number;
  target: number;
  earned: boolean;
  /** 0..1 */
  progress: number;
}

export function badgeStates(stats: Stats): BadgeState[] {
  return BADGES.map((b) => {
    const value = Math.max(0, b.value(stats));
    return { id: b.id, value, target: b.target, earned: value >= b.target, progress: Math.min(1, value / b.target) };
  });
}

/**
 * Kazanılmış rozetlerin kazanıldığı gün: veri gün gün yeniden oynatılır, rozetin ilk sağlandığı gün alınır.
 * Rozet kuralları birikimli olduğundan (sayı, en iyi değer, en uzun seri) bir kez sağlanan kural sonra da sağlanır.
 */
export function badgeDates(data: GameData, todayKey: string): Map<string, string> {
  const earnedNow = new Set(badgeStates(computeStats(data, todayKey)).filter((b) => b.earned).map((b) => b.id));
  const out = new Map<string, string>();
  if (earnedNow.size === 0) return out;
  const allDays = xpDays(data);
  for (let i = 0; i < allDays.length && out.size < earnedNow.size; i++) {
    const key = allDays[i].key;
    const stats = computeStats(dataUntil(data, key), key, allDays.slice(0, i + 1));
    for (const b of badgeStates(stats)) {
      if (b.earned && earnedNow.has(b.id) && !out.has(b.id)) out.set(b.id, key);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Özet

export interface GameSnapshot {
  today: string;
  xp: number;
  level: LevelInfo;
  todayXp: number;
  quests: QuestState[];
  badges: BadgeState[];
  days: DayXp[];
  streak: number;
}

export function gameSnapshot(data: GameData, todayKey: string): GameSnapshot {
  const past = dataUntil(data, todayKey);
  const days = xpDays(past);
  const xp = totalXp(days);
  const todayData = groupByDay(past).get(todayKey) ?? emptyData();
  return {
    today: todayKey,
    xp,
    level: levelInfo(xp),
    todayXp: days.find((d) => d.key === todayKey)?.xp ?? 0,
    quests: questStates(todayKey, todayData),
    badges: badgeStates(computeStats(past, todayKey, days)),
    days,
    streak: streaks(past.sessions, todayKey).current,
  };
}

export interface GameNews {
  badges: string[];
  quests: QuestId[];
}

/** Daha önce görülenlere göre yeni kazanılan rozetler ve bugün yeni tamamlanan görevler. */
export function diffNews(snap: GameSnapshot, seenBadges: string[], seenQuests: string[]): GameNews {
  return {
    badges: snap.badges.filter((b) => b.earned && !seenBadges.includes(b.id)).map((b) => b.id),
    quests: snap.quests.filter((q) => q.done && !seenQuests.includes(q.id)).map((q) => q.id),
  };
}
