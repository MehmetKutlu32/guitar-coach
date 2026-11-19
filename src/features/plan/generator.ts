import { clampBpm } from '../../audio/clock';
import type { Key } from '../../i18n';
import { EAR_PASS, EAR_ROUND, earLevels, isPass, itemAccuracy, unlockedLevel, type EarKind, type EarResult } from '../../music/ear';
import { gameScore, type GameMode, type GameResult } from '../../music/fretboard';
import { scaleRootName, type ScaleId } from '../../music/scales';
import { COMMON_NAMES } from '../../music/theory';
import { pairKey, perMinute, type TransitionResult } from '../chords/transitions';
import { activityTotals, addDays, dayKey, type SessionRecord } from '../log/stats';
import type { RhythmResult } from '../rhythm/analysis';

/** Kural tabanlı günlük plan üretici. Tamamen saf: aynı girdi her zaman aynı planı verir. */

export type Goal = 'chords' | 'lead' | 'riffs' | 'all';

export interface Profile {
  /** 0 = yeni başlayan, 1 = temel, 2 = orta. */
  level: 0 | 1 | 2;
  /** Beceri öz değerlendirmeleri, 0–2. */
  open: number;
  barre: number;
  rhythm: number;
  lead: number;
  goal: Goal;
  /** Testin yapıldığı an. */
  date: number;
  /** Test atlandıysa varsayılan profil. */
  skipped?: boolean;
}

export interface Question {
  id: 'experience' | 'open' | 'barre' | 'rhythm' | 'lead' | 'goal';
  text: Key;
  options: { text: Key; value: number }[];
}

export const QUESTIONS: Question[] = [
  {
    id: 'experience',
    text: 'test.q.experience',
    options: [
      { text: 'test.a.exp0', value: 0 },
      { text: 'test.a.exp1', value: 1 },
      { text: 'test.a.exp2', value: 2 },
    ],
  },
  {
    id: 'open',
    text: 'test.q.open',
    options: [
      { text: 'test.a.open0', value: 0 },
      { text: 'test.a.open1', value: 1 },
      { text: 'test.a.open2', value: 2 },
    ],
  },
  {
    id: 'barre',
    text: 'test.q.barre',
    options: [
      { text: 'test.a.barre0', value: 0 },
      { text: 'test.a.barre1', value: 1 },
      { text: 'test.a.barre2', value: 2 },
    ],
  },
  {
    id: 'rhythm',
    text: 'test.q.rhythm',
    options: [
      { text: 'test.a.rhythm0', value: 0 },
      { text: 'test.a.rhythm1', value: 1 },
      { text: 'test.a.rhythm2', value: 2 },
    ],
  },
  {
    id: 'lead',
    text: 'test.q.lead',
    options: [
      { text: 'test.a.lead0', value: 0 },
      { text: 'test.a.lead1', value: 1 },
      { text: 'test.a.lead2', value: 2 },
    ],
  },
  {
    id: 'goal',
    text: 'test.q.goal',
    options: [
      { text: 'test.a.goalChords', value: 0 },
      { text: 'test.a.goalLead', value: 1 },
      { text: 'test.a.goalRiffs', value: 2 },
      { text: 'test.a.goalAll', value: 3 },
    ],
  },
];

const GOALS: Goal[] = ['chords', 'lead', 'riffs', 'all'];

/** Test yanıtlarından profil çıkarır. Eksik yanıtlar 0 sayılır. */
export function scoreProfile(answers: Partial<Record<Question['id'], number>>, date: number): Profile {
  const v = (id: Question['id']) => Math.max(0, Math.min(3, answers[id] ?? 0));
  const open = Math.min(2, v('open'));
  const barre = Math.min(2, v('barre'));
  const rhythm = Math.min(2, v('rhythm'));
  const lead = Math.min(2, v('lead'));
  const total = Math.min(2, v('experience')) + open + barre + rhythm + lead;
  const level = total <= 2 ? 0 : total <= 6 ? 1 : 2;
  return { level, open, barre, rhythm, lead, goal: GOALS[v('goal')] ?? 'all', date };
}

export const DEFAULT_PROFILE: Profile = { level: 0, open: 0, barre: 0, rhythm: 0, lead: 0, goal: 'all', date: 0, skipped: true };

export type PlanMinutes = 15 | 30 | 45;

export type PlanSetup =
  | { kind: 'tune' }
  | { kind: 'transition'; a: string; b: string; seconds: number }
  | { kind: 'rhythm'; bpm: number; what: string; bars: number }
  | { kind: 'pattern'; bpm: number; patternId: string }
  | { kind: 'backing'; progressionId: string; key: number; bpm: number; style: 'rock' | 'blues' | 'pop' | 'funk' }
  | { kind: 'ear'; earKind: EarKind; level: number }
  | { kind: 'fretgame'; mode: GameMode; maxFret: number; naturals: boolean }
  | { kind: 'scale'; root: number; scale: ScaleId }
  | { kind: 'song'; id: string; bpm: number }
  | { kind: 'tab'; id: string; speed: number };

export interface Text {
  key: Key;
  params?: Record<string, string | number>;
  /** Değeri de çevrilecek parametreler (değer bir metin anahtarı; ör. aralık ya da gam adı). */
  refs?: Record<string, Key>;
}

/** Plana girebilecek bir şarkı ya da tab (hazır ya da kullanıcının). */
export interface Piece {
  id: string;
  name: string;
  /** Özgün tempo. */
  bpm: number;
}

export interface PlanItem {
  /** Gün içinde kararlı kimlik (tamamlandı işareti bununla tutulur). */
  id: string;
  minutes: number;
  title: Text;
  /** Bu maddenin neden seçildiği. */
  reason: Text;
  setup: PlanSetup;
}

export interface PlanInput {
  profile: Profile;
  minutes: PlanMinutes;
  /** Bugünün gün anahtarı (YYYY-AA-GG). */
  today: string;
  transitions: TransitionResult[];
  rhythm: RhythmResult[];
  sessions: SessionRecord[];
  /** Kulak eğitimi turları. */
  ear: EarResult[];
  /** Sapta nota oyunu turları. */
  fretgame: GameResult[];
  /** Şarkı modundaki şarkılar (hazırlar + kullanıcının). */
  songs: Piece[];
  /** Riff kütüphanesindeki tablar (hazırlar + kullanıcının). */
  tabs: Piece[];
}

const OPEN_PAIRS: [string, string][] = [
  ['Em', 'G'],
  ['Am', 'C'],
  ['C', 'G'],
  ['D', 'A'],
  ['G', 'D'],
  ['Am', 'Em'],
  ['A', 'E'],
  ['D', 'G'],
  ['Am', 'Dm'],
  ['C', 'F'],
];
const SEVENTH_PAIRS: [string, string][] = [
  ['A7', 'D7'],
  ['E7', 'A7'],
  ['G7', 'C'],
  ['B7', 'Em'],
  ['Dm7', 'G7'],
];
const BARRE_PAIRS: [string, string][] = [
  ['F', 'C'],
  ['Bm', 'G'],
  ['F#m', 'A'],
  ['Bm', 'D'],
  ['F', 'Bb'],
];

/** Profilin hedeflediği akor çiftleri, öğrenme sırasıyla. */
export function pairPool(profile: Profile): [string, string][] {
  if (profile.open < 2) return OPEN_PAIRS;
  if (profile.barre < 2) return [...SEVENTH_PAIRS.slice(0, 3), ...BARRE_PAIRS, ...SEVENTH_PAIRS.slice(3)];
  return [...BARRE_PAIRS, ...SEVENTH_PAIRS];
}

/** Bir çiftin "oturmuş" sayılması için dakikadaki geçiş hedefi. */
export function targetRate(profile: Profile): number {
  return [30, 45, 60][profile.level];
}

/** Gün anahtarından kararlı bir sıra numarası (günden güne çeşitlilik için). */
export function dayIndex(today: string): number {
  const [y, m, d] = today.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

interface PairChoice {
  a: string;
  b: string;
  reason: Text;
}

/** Çalışılacak akor çiftlerini seçer: önce zayıf olanlar, sonra hiç çalışılmamışlar, sonra en eskiler. */
export function choosePairs(input: PlanInput, count: number): PairChoice[] {
  const { profile, transitions, today } = input;
  const target = targetRate(profile);
  const byPair = new Map<string, TransitionResult[]>();
  for (const r of transitions) {
    const list = byPair.get(r.pair);
    if (list) list.push(r);
    else byPair.set(r.pair, [r]);
  }
  const practiced = [...byPair.entries()].map(([pair, list]) => {
    list.sort((x, y) => x.date - y.date);
    const last = list[list.length - 1];
    return { pair, a: last.a, b: last.b, last: perMinute(last), best: Math.max(...list.map(perMinute)), lastDate: last.date };
  });

  const out: PairChoice[] = [];
  const used = new Set<string>();
  const add = (a: string, b: string, reason: Text) => {
    const k = pairKey(a, b);
    if (used.has(k) || out.length >= count) return;
    used.add(k);
    out.push({ a, b, reason });
  };

  // 1) Hedefin altında kalan çiftler, en zayıftan başlayarak.
  const weak = practiced.filter((p) => p.best < target).sort((x, y) => x.last - y.last);
  if (weak.length > 0) {
    // En zayıf iki çift arasında günden güne dönüşüm: hep aynı çiftle sıkılmasın.
    const pick = weak[Math.min(weak.length - 1, dayIndex(today) % Math.min(2, weak.length))];
    add(pick.a, pick.b, { key: 'plan.why.weak', params: { a: pick.a, b: pick.b, n: pick.last, target } });
  }
  // 2) Sıradaki, hiç çalışılmamış çift.
  const fresh = pairPool(profile).find(([a, b]) => !byPair.has(pairKey(a, b)));
  if (fresh) add(fresh[0], fresh[1], { key: transitions.length ? 'plan.why.new' : 'plan.why.first', params: { a: fresh[0], b: fresh[1] } });
  // 3) Kalan zayıflar.
  for (const p of weak) add(p.a, p.b, { key: 'plan.why.weak', params: { a: p.a, b: p.b, n: p.last, target } });
  // 4) En uzun süredir çalışılmayan.
  for (const p of [...practiced].sort((x, y) => x.lastDate - y.lastDate)) {
    const days = Math.max(0, dayIndex(today) - dayIndex(dayKey(p.lastDate)));
    add(p.a, p.b, { key: 'plan.why.stale', params: { a: p.a, b: p.b, days } });
  }
  // 5) Hiçbir şey yoksa havuzun başı.
  for (const [a, b] of pairPool(profile)) add(a, b, { key: 'plan.why.first', params: { a, b } });
  return out;
}

export interface RhythmChoice {
  bpm: number;
  what: string;
  reason: Text;
}

/** Ritim çalışmasının temposunu ve türünü son sonuçlara göre ayarlar. */
export function chooseRhythm(input: PlanInput): RhythmChoice {
  const { profile, rhythm } = input;
  const recent = [...rhythm].sort((x, y) => x.date - y.date).slice(-3);
  if (recent.length === 0) {
    const start: [number, string][] = [
      [70, 'div:1'],
      [80, 'div:2'],
      [90, 'div:2'],
    ];
    const [bpm, what] = start[profile.level];
    return { bpm, what, reason: { key: 'plan.why.rhythmFirst' } };
  }
  const last = recent[recent.length - 1];
  const accuracy = Math.round(recent.reduce((s, r) => s + r.accuracy, 0) / recent.length);
  const what = last.what.startsWith('div:') ? last.what : 'div:2';
  if (accuracy < 60) {
    return { bpm: Math.max(50, last.bpm - 10), what, reason: { key: 'plan.why.rhythmSlow', params: { n: accuracy } } };
  }
  if (accuracy < 85) {
    if (Math.abs(last.meanMs) > 20) {
      return {
        bpm: last.bpm,
        what,
        reason: { key: last.meanMs < 0 ? 'plan.why.rhythmEarly' : 'plan.why.rhythmLate', params: { n: Math.abs(Math.round(last.meanMs)) } },
      };
    }
    return { bpm: last.bpm, what, reason: { key: 'plan.why.rhythmHold', params: { n: accuracy } } };
  }
  // İyi gidiyor: önce nota değerini sıklaştır, sonra tempoyu artır.
  if (what === 'div:1') return { bpm: last.bpm, what: 'div:2', reason: { key: 'plan.why.rhythmUp', params: { n: accuracy } } };
  return { bpm: Math.min(160, last.bpm + 5), what, reason: { key: 'plan.why.rhythmUp', params: { n: accuracy } } };
}

const JAMS: { progressionId: string; key: number; bpm: number; style: 'rock' | 'blues' | 'pop' | 'funk'; scale: ScaleId }[][] = [
  [
    { progressionId: 'minorRock', key: 9, bpm: 80, style: 'rock', scale: 'minorPent' },
    { progressionId: 'blues12', key: 9, bpm: 80, style: 'blues', scale: 'minorPent' },
    { progressionId: 'minorRock', key: 4, bpm: 85, style: 'rock', scale: 'minorPent' },
  ],
  [
    { progressionId: 'blues12', key: 9, bpm: 95, style: 'blues', scale: 'blues' },
    { progressionId: 'pop1564', key: 7, bpm: 95, style: 'pop', scale: 'majorPent' },
    { progressionId: 'minorPop', key: 4, bpm: 100, style: 'rock', scale: 'minorPent' },
    { progressionId: 'blues12', key: 4, bpm: 100, style: 'blues', scale: 'blues' },
  ],
  [
    { progressionId: 'dorianVamp', key: 9, bpm: 100, style: 'funk', scale: 'dorian' },
    { progressionId: 'minorBlues', key: 2, bpm: 90, style: 'blues', scale: 'blues' },
    { progressionId: 'mixo', key: 7, bpm: 110, style: 'rock', scale: 'mixolydian' },
    { progressionId: 'jazz251', key: 0, bpm: 110, style: 'pop', scale: 'major' },
    { progressionId: 'andalusian', key: 9, bpm: 100, style: 'rock', scale: 'harmonicMinor' },
  ],
];

const PATTERNS = [
  ['q4', 'basic'],
  ['basic', 'folk', 'e8'],
  ['folk', 'sync', 'mute', 'funk16'],
];

/** Son 7 günde (bugün dahil) bir egzersiz türüne harcanan saniye. */
export function recentSeconds(sessions: SessionRecord[], today: string, activity: string): number {
  return activityTotals(sessions, addDays(today, -6)).find((a) => a.activity === activity)?.seconds ?? 0;
}

// ---------- Ek konular: kulak eğitimi, sap ve teori, şarkı / tab ----------

/** Temel bloklara (akort, geçiş, ritim, eşlik) ek olarak plana giren konular. */
export type Extra = 'ear' | 'theory' | 'repertoire';

/** Ek konunun günlükteki egzersiz türleri (oturum kayıtlarında). */
const EXTRA_ACTIVITIES: Record<Extra, string[]> = {
  ear: ['ear'],
  theory: ['theory'],
  repertoire: ['song', 'tab'],
};

/** Hedefe göre ek konuların öncelik sırası ("hepsi" hedefinde sıra günden güne döner). */
const GOAL_EXTRAS: Record<Goal, Extra[]> = {
  chords: ['repertoire', 'ear', 'theory'],
  lead: ['theory', 'ear', 'repertoire'],
  riffs: ['repertoire', 'theory', 'ear'],
  all: ['ear', 'theory', 'repertoire'],
};

/** "Uzun süredir çalışılmadı" puanının üst sınırı (gün); hiç çalışılmamış konu da bu kadar sayılır. */
export const STALE_CAP = 14;

/** Bugünden önceki kayıtlar: konu ve içerik seçimi gün içinde değişmesin diye bugünün sonuçları sayılmaz. */
const beforeToday = <T extends { date: number }>(list: T[], today: string): T[] => list.filter((r) => dayKey(r.date) < today);

/** Ek konunun bugünden önce en son çalışıldığı günden bu yana geçen gün (hiç çalışılmadıysa null). */
export function daysSinceExtra(input: PlanInput, extra: Extra): number | null {
  const { today } = input;
  const dates: number[] = beforeToday(input.sessions, today)
    .filter((s) => EXTRA_ACTIVITIES[extra].some((a) => (s.activities[a] ?? 0) > 0))
    .map((s) => s.date);
  if (extra === 'ear') dates.push(...beforeToday(input.ear, today).map((r) => r.date));
  if (extra === 'theory') dates.push(...beforeToday(input.fretgame, today).map((r) => r.date));
  if (dates.length === 0) return null;
  return Math.max(0, dayIndex(today) - dayIndex(dayKey(Math.max(...dates))));
}

/**
 * Ek konuları öncelik sırasıyla verir. Puan = hedefe göre öncelik (4 / 2 / 0) + son çalışmadan bu yana gün
 * (en çok STALE_CAP). Böylece hedefle ilgili konu öne çıkar, ama birkaç gündür ihmal edilen konu onu geçer.
 */
export function chooseExtras(input: PlanInput): Extra[] {
  const base = GOAL_EXTRAS[input.profile.goal];
  const shiftBy = input.profile.goal === 'all' ? dayIndex(input.today) % base.length : 0;
  const order = [...base.slice(shiftBy), ...base.slice(0, shiftBy)];
  return order
    .map((extra, i) => ({ extra, i, score: (order.length - 1 - i) * 2 + Math.min(STALE_CAP, daysSinceExtra(input, extra) ?? STALE_CAP) }))
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .map((x) => x.extra);
}

export interface EarChoice {
  kind: EarKind;
  level: number;
  reason: Text;
}

/** Kulak eğitimi: iki türden açık seviyesi düşük olanı, o seviyede; nedeni en zayıf aralık / akor türü. */
export function chooseEar(input: PlanInput): EarChoice {
  const results = beforeToday(input.ear, input.today);
  const interval = unlockedLevel(results, 'interval');
  const chord = unlockedLevel(results, 'chord');
  let kind: EarKind;
  if (interval !== chord) kind = interval < chord ? 'interval' : 'chord';
  else if (input.profile.goal === 'chords') kind = 'chord';
  else if (input.profile.goal === 'lead') kind = 'interval';
  else kind = dayIndex(input.today) % 2 === 0 ? 'interval' : 'chord';
  const level = kind === 'interval' ? interval : chord;
  const items = earLevels(kind)[level - 1].items;
  const weakest = itemAccuracy(results, kind).find((a) => items.includes(a.item) && a.asked >= 3 && a.percent < EAR_PASS);
  let reason: Text;
  if (weakest) {
    const name = (kind === 'interval' ? `interval.${weakest.item}` : `ear.chord.${weakest.item}`) as Key;
    reason = { key: 'plan.why.earWeak', params: { n: weakest.percent }, refs: { name } };
  } else if (!results.some((r) => r.kind === kind)) {
    reason = { key: 'plan.why.earFirst' };
  } else if (level === earLevels(kind).length && results.some((r) => r.kind === kind && r.level === level && isPass(r))) {
    reason = { key: 'plan.why.earTop' };
  } else {
    reason = { key: 'plan.why.earLevel', params: { need: Math.ceil((EAR_PASS / 100) * EAR_ROUND), total: EAR_ROUND } };
  }
  return { kind, level, reason };
}

/** Nota oyunu ayar basamakları: kolaydan zora. */
export const GAME_STEPS: { mode: GameMode; maxFret: number; naturals: boolean }[] = [
  { mode: 'name', maxFret: 5, naturals: true },
  { mode: 'find', maxFret: 5, naturals: true },
  { mode: 'name', maxFret: 12, naturals: true },
  { mode: 'find', maxFret: 12, naturals: true },
  { mode: 'name', maxFret: 12, naturals: false },
  { mode: 'find', maxFret: 12, naturals: false },
];
/** Seviyeye göre ilk basamak. */
const GAME_START = [0, 0, 2];
/** Bir basamağın "oturmuş" sayılması için son turunun puanı. */
export const GAME_MASTERED = 90;
/** Son turların ortalaması bunun altındaysa oyun önerilir. */
export const GAME_LOW = 80;
/** Oyun bu kadar gündür oynanmadıysa yeniden önerilir. */
export const GAME_STALE_DAYS = 7;

export type TheoryChoice =
  | { kind: 'fretgame'; step: (typeof GAME_STEPS)[number]; reason: Text }
  | { kind: 'scale'; root: number; scale: ScaleId; reason: Text };

/**
 * Sap ve teori: nota oyununun puanı düşükse ya da oyun uzun süredir oynanmadıysa oyun (sıradaki oturmamış
 * basamakta); yoksa o günün eşliğinin tonunda, eşlikte önerilen gam.
 */
export function chooseTheory(input: PlanInput, jam: { key: number; scale: ScaleId }): TheoryChoice {
  const rounds = [...beforeToday(input.fretgame, input.today)].sort((x, y) => x.date - y.date);
  let step = GAME_START[input.profile.level];
  while (step < GAME_STEPS.length - 1) {
    const s = GAME_STEPS[step];
    const last = rounds.filter((r) => r.mode === s.mode && r.maxFret === s.maxFret && r.naturalsOnly === s.naturals).pop();
    if (!last || gameScore(last.correct, last.total) < GAME_MASTERED) break;
    step++;
  }
  const game = (reason: Text): TheoryChoice => ({ kind: 'fretgame', step: GAME_STEPS[step], reason });
  if (rounds.length === 0) return game({ key: 'plan.why.gameFirst' });
  const recent = rounds.slice(-3);
  const avg = Math.round(recent.reduce((s, r) => s + gameScore(r.correct, r.total), 0) / recent.length);
  if (avg < GAME_LOW) return game({ key: 'plan.why.gameLow', params: { n: avg, target: GAME_LOW } });
  const days = dayIndex(input.today) - dayIndex(dayKey(rounds[rounds.length - 1].date));
  if (days >= GAME_STALE_DAYS) return game({ key: 'plan.why.gameStale', params: { days } });
  return { kind: 'scale', root: jam.key, scale: jam.scale, reason: { key: 'plan.why.scale', params: { key: COMMON_NAMES[jam.key] } } };
}

/** Hazır şarkı ve tabların zorluğu (bu seviyeden itibaren önerilir). Kullanıcının kendi parçaları hep uygun sayılır. */
export const PIECE_LEVEL: Record<string, 0 | 1 | 2> = {
  'builtin:dort-akor': 0,
  'builtin:pazartesi-blues': 1,
  'builtin:sahil-yolu': 1,
  'builtin:kromatik': 0,
  'builtin:tel-atlama': 0,
  'builtin:power': 0,
  'builtin:pentatonik': 1,
  'builtin:boogie': 1,
};

/** Hedefe göre şarkı / tab dönüşümü (günden güne). */
const REPERTOIRE_CYCLE: Record<Goal, ('song' | 'tab')[]> = {
  chords: ['song', 'song', 'tab'],
  lead: ['tab', 'song', 'tab'],
  riffs: ['tab', 'tab', 'song'],
  all: ['song', 'tab'],
};
/** Seviyeye göre şarkı temposu (özgün tempoya oran) ve tab hızı (%). */
export const SONG_TEMPO = [0.75, 0.9, 1];
export const TAB_SPEED = [50, 75, 100];

export type RepertoireChoice =
  | { kind: 'song'; piece: Piece; bpm: number; percent: number }
  | { kind: 'tab'; piece: Piece; speed: number };

/** Şarkı ya da riff: hedefe göre tür, parça günden güne döner; yeni başlayana yavaşlatılmış. */
export function chooseRepertoire(input: PlanInput): RepertoireChoice | null {
  const { profile } = input;
  const day = dayIndex(input.today);
  const cycle = REPERTOIRE_CYCLE[profile.goal];
  const fits = (list: Piece[]) => list.filter((p) => (PIECE_LEVEL[p.id] ?? 0) <= profile.level);
  const wanted = cycle[day % cycle.length];
  let kind: 'song' | 'tab' = wanted;
  let pool = fits(wanted === 'song' ? input.songs : input.tabs);
  if (pool.length === 0) {
    kind = wanted === 'song' ? 'tab' : 'song';
    pool = fits(kind === 'song' ? input.songs : input.tabs);
  }
  if (pool.length === 0) return null;
  const piece = pool[Math.floor(day / cycle.length) % pool.length];
  if (kind === 'tab') return { kind, piece, speed: TAB_SPEED[profile.level] };
  const ratio = SONG_TEMPO[profile.level];
  return { kind, piece, bpm: clampBpm(piece.bpm * ratio), percent: Math.round(ratio * 100) };
}

function extraItem(input: PlanInput, extra: Extra, minutes: number, jam: { key: number; scale: ScaleId }): PlanItem | null {
  if (extra === 'ear') {
    const e = chooseEar(input);
    return {
      id: `ear:${e.kind}:${e.level}`,
      minutes,
      title: { key: e.kind === 'interval' ? 'plan.item.earInterval' : 'plan.item.earChord', params: { level: e.level } },
      reason: e.reason,
      setup: { kind: 'ear', earKind: e.kind, level: e.level },
    };
  }
  if (extra === 'theory') {
    const th = chooseTheory(input, jam);
    if (th.kind === 'scale') {
      return {
        id: `scale:${th.root}:${th.scale}`,
        minutes,
        title: { key: 'plan.item.scale', params: { root: scaleRootName(th.root, th.scale) }, refs: { scale: `scale.${th.scale}` as Key } },
        reason: th.reason,
        setup: { kind: 'scale', root: th.root, scale: th.scale },
      };
    }
    const s = th.step;
    return {
      id: `fretgame:${s.mode}:${s.maxFret}:${s.naturals ? 'n' : 'a'}`,
      minutes,
      title: { key: 'plan.item.fretgame', params: { n: s.maxFret }, refs: { mode: s.mode === 'name' ? 'game.modeName' : 'game.modeFind' } },
      reason: th.reason,
      setup: { kind: 'fretgame', mode: s.mode, maxFret: s.maxFret, naturals: s.naturals },
    };
  }
  const r = chooseRepertoire(input);
  if (!r) return null;
  if (r.kind === 'tab') {
    return {
      id: `tab:${r.piece.id}`,
      minutes,
      title: { key: 'plan.item.tab', params: { name: r.piece.name, n: r.speed } },
      reason: { key: r.speed < 100 ? 'plan.why.tabSlow' : 'plan.why.tab' },
      setup: { kind: 'tab', id: r.piece.id, speed: r.speed },
    };
  }
  return {
    id: `song:${r.piece.id}`,
    minutes,
    title: { key: 'plan.item.song', params: { name: r.piece.name, bpm: r.bpm } },
    reason: r.percent < 100 ? { key: 'plan.why.songSlow', params: { n: r.percent } } : { key: 'plan.why.song' },
    setup: { kind: 'song', id: r.piece.id, bpm: r.bpm },
  };
}

/** Plandaki gösterim sırası (dakikalar öncelikle dağıtılır, sıra sabittir). */
const KIND_ORDER: PlanSetup['kind'][] = ['tune', 'transition', 'rhythm', 'pattern', 'fretgame', 'scale', 'backing', 'song', 'tab', 'ear'];

/**
 * Dakikaların bloklara dağılımı:
 * [akort, geçiş 1, geçiş 2, ritim, vuruş kalıbı, eşlik, ek konu 1, ek konu 2, ek konu 3].
 * Ek konu dakikaları öncelik sırasına göre verilir (en öncelikli konu en uzun süreyi alır).
 */
const SPLIT: Record<PlanMinutes, number[]> = {
  15: [1, 4, 0, 3, 0, 4, 3, 0, 0],
  30: [2, 5, 4, 6, 0, 6, 4, 3, 0],
  45: [2, 6, 5, 7, 5, 8, 5, 4, 3],
};

/** Günlük planı üretir. Dakikaların toplamı her zaman istenen süreye eşittir. */
export function generatePlan(input: PlanInput): PlanItem[] {
  const { profile, minutes, today, sessions } = input;
  const split = [...SPLIT[minutes]];
  const day = dayIndex(today);

  // Hedefe göre birkaç dakikayı kaydır (toplam değişmez).
  const shift = minutes === 15 ? 1 : 2;
  if (profile.goal === 'lead' && split[1] > shift + 2) {
    split[1] -= shift;
    split[5] += shift;
  } else if (profile.goal === 'chords' && split[5] > shift + 2) {
    split[5] -= shift;
    split[1] += shift;
  }
  // Bu hafta en az çalışılan konuya bir dakika daha (ihmal edilen konu öne çıksın).
  const blocks: [activity: string, index: number][] = [
    ['chords', 1],
    ['rhythm', 3],
    ['backing', 5],
  ];
  const usage = blocks.map(([a, i]) => ({ a, i, s: recentSeconds(sessions, today, a) }));
  const anyPractice = usage.some((u) => u.s > 0);
  const neglected = anyPractice ? [...usage].sort((x, y) => x.s - y.s)[0] : null;
  if (neglected && neglected.s === 0 && split[0] > 1) {
    split[0] -= 1;
    split[neglected.i] += 1;
  }

  const items: PlanItem[] = [];
  items.push({
    id: 'tune',
    minutes: split[0],
    title: { key: 'plan.item.tune' },
    reason: { key: 'plan.why.tune' },
    setup: { kind: 'tune' },
  });

  const pairs = choosePairs(input, split[2] > 0 ? 2 : 1);
  pairs.forEach((p, i) => {
    const mins = split[i === 0 ? 1 : 2];
    if (mins <= 0) return;
    items.push({
      id: `transition:${pairKey(p.a, p.b)}`,
      minutes: mins,
      title: { key: 'plan.item.transition', params: { a: p.a, b: p.b } },
      reason: p.reason,
      setup: { kind: 'transition', a: p.a, b: p.b, seconds: 60 },
    });
  });
  // İkinci çift bulunamadıysa dakikası ilkine eklenir.
  if (split[2] > 0 && pairs.length < 2) items[items.length - 1].minutes += split[2];

  const r = chooseRhythm(input);
  items.push({
    id: `rhythm:${r.bpm}:${r.what}`,
    minutes: split[3],
    title: { key: `plan.item.rhythm${r.what.slice(4)}` as Key, params: { bpm: r.bpm } },
    reason:
      neglected?.a === 'rhythm' && neglected.s === 0 && input.rhythm.length > 0 ? { key: 'plan.why.neglected' } : r.reason,
    setup: { kind: 'rhythm', bpm: r.bpm, what: r.what, bars: minutes === 15 ? 8 : 16 },
  });

  if (split[4] > 0) {
    const list = PATTERNS[profile.level];
    const patternId = list[day % list.length];
    items.push({
      id: `pattern:${patternId}`,
      minutes: split[4],
      title: { key: 'plan.item.pattern', params: { bpm: Math.max(60, r.bpm - 10) } },
      reason: { key: 'plan.why.pattern' },
      setup: { kind: 'pattern', bpm: Math.max(60, r.bpm - 10), patternId },
    });
  }

  const jams = JAMS[profile.level];
  const jam = jams[day % jams.length];
  const backing: PlanItem = {
    id: `backing:${jam.progressionId}:${jam.key}`,
    minutes: split[5],
    title: { key: 'plan.item.backing', params: { key: COMMON_NAMES[jam.key], bpm: jam.bpm } },
    reason:
      recentSeconds(sessions, today, 'backing') === 0 && anyPractice
        ? { key: 'plan.why.neglected' }
        : { key: 'plan.why.backing', params: { key: COMMON_NAMES[jam.key] } },
    setup: { kind: 'backing', progressionId: jam.progressionId, key: jam.key, bpm: jam.bpm, style: jam.style },
  };
  items.push(backing);

  // Ek konular: öncelik sırasıyla ek dakika bloklarına. İçerik bulunamazsa (ör. hiç parça yok) dakikası eşliğe.
  const extras = chooseExtras(input);
  split.slice(6).forEach((mins, i) => {
    if (mins <= 0) return;
    const item = extraItem(input, extras[i], mins, jam);
    if (item) items.push(item);
    else backing.minutes += mins;
  });

  return items.filter((it) => it.minutes > 0).sort((x, y) => KIND_ORDER.indexOf(x.setup.kind) - KIND_ORDER.indexOf(y.setup.kind));
}

/** Bugünkü oturum kayıtlarında bir egzersiz türüne harcanan saniye. */
function todaySeconds(sessions: SessionRecord[], today: string, activity: string): number {
  return sessions.filter((s) => dayKey(s.date) === today).reduce((sum, s) => sum + (s.activities[activity] ?? 0), 0);
}

/** Sonuç kaydı tutmayan araçlarda (gam, şarkı, tab) bugünkü oturumlarda maddenin süresinin en az bu oranı çalışılınca tamam sayılır. */
export const SESSION_DONE_RATIO = 0.5;

/**
 * Bugün kaydedilen sonuçlara bakarak kendiliğinden tamamlanmış sayılan maddeler: geçiş (aynı çift), ritim, kulak
 * eğitimi (aynı tür), nota oyunu için bugünkü sonuç; gam, şarkı ve tab için bugünkü oturumlarda o araçta geçen süre.
 */
export function autoDone(
  items: PlanItem[],
  input: Pick<PlanInput, 'today' | 'transitions' | 'rhythm'> & Partial<Pick<PlanInput, 'ear' | 'fretgame' | 'sessions'>>,
): string[] {
  const { today } = input;
  const isToday = (r: { date: number }) => dayKey(r.date) === today;
  const sessionDone = (activity: string, minutes: number) =>
    todaySeconds(input.sessions ?? [], today, activity) >= minutes * 60 * SESSION_DONE_RATIO;
  const done: string[] = [];
  for (const it of items) {
    const s = it.setup;
    let ok = false;
    if (s.kind === 'transition') {
      const key = pairKey(s.a, s.b);
      ok = input.transitions.some((r) => r.pair === key && isToday(r));
    } else if (s.kind === 'rhythm') {
      ok = input.rhythm.some(isToday);
    } else if (s.kind === 'ear') {
      ok = (input.ear ?? []).some((r) => r.kind === s.earKind && isToday(r));
    } else if (s.kind === 'fretgame') {
      ok = (input.fretgame ?? []).some(isToday);
    } else if (s.kind === 'scale') {
      ok = sessionDone('theory', it.minutes);
    } else if (s.kind === 'song' || s.kind === 'tab') {
      ok = sessionDone(s.kind, it.minutes);
    }
    if (ok) done.push(it.id);
  }
  return done;
}

export function isProfile(v: unknown): v is Profile {
  if (!v || typeof v !== 'object') return false;
  const p = v as Partial<Profile>;
  return (
    typeof p.level === 'number' &&
    typeof p.open === 'number' &&
    typeof p.barre === 'number' &&
    typeof p.rhythm === 'number' &&
    typeof p.lead === 'number' &&
    typeof p.goal === 'string'
  );
}
