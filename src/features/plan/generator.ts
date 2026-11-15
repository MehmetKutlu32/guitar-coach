import type { Key } from '../../i18n';
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
  | { kind: 'backing'; progressionId: string; key: number; bpm: number; style: 'rock' | 'blues' | 'pop' | 'funk' };

export interface Text {
  key: Key;
  params?: Record<string, string | number>;
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

const JAMS: { progressionId: string; key: number; bpm: number; style: 'rock' | 'blues' | 'pop' | 'funk'; scale: Key }[][] = [
  [
    { progressionId: 'minorRock', key: 9, bpm: 80, style: 'rock', scale: 'scale.minorPent' },
    { progressionId: 'blues12', key: 9, bpm: 80, style: 'blues', scale: 'scale.minorPent' },
    { progressionId: 'minorRock', key: 4, bpm: 85, style: 'rock', scale: 'scale.minorPent' },
  ],
  [
    { progressionId: 'blues12', key: 9, bpm: 95, style: 'blues', scale: 'scale.blues' },
    { progressionId: 'pop1564', key: 7, bpm: 95, style: 'pop', scale: 'scale.majorPent' },
    { progressionId: 'minorPop', key: 4, bpm: 100, style: 'rock', scale: 'scale.minorPent' },
    { progressionId: 'blues12', key: 4, bpm: 100, style: 'blues', scale: 'scale.blues' },
  ],
  [
    { progressionId: 'dorianVamp', key: 9, bpm: 100, style: 'funk', scale: 'scale.dorian' },
    { progressionId: 'minorBlues', key: 2, bpm: 90, style: 'blues', scale: 'scale.blues' },
    { progressionId: 'mixo', key: 7, bpm: 110, style: 'rock', scale: 'scale.mixolydian' },
    { progressionId: 'jazz251', key: 0, bpm: 110, style: 'pop', scale: 'scale.major' },
    { progressionId: 'andalusian', key: 9, bpm: 100, style: 'rock', scale: 'scale.harmonicMinor' },
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

/** Dakikaların bloklara dağılımı: [akort, geçiş 1, geçiş 2, ritim, vuruş kalıbı, eşlik]. */
const SPLIT: Record<PlanMinutes, number[]> = {
  15: [1, 5, 0, 5, 0, 4],
  30: [2, 6, 5, 8, 0, 9],
  45: [2, 7, 6, 10, 8, 12],
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
  items.push({
    id: `backing:${jam.progressionId}:${jam.key}`,
    minutes: split[5],
    title: { key: 'plan.item.backing', params: { key: COMMON_NAMES[jam.key], bpm: jam.bpm } },
    reason:
      recentSeconds(sessions, today, 'backing') === 0 && anyPractice
        ? { key: 'plan.why.neglected' }
        : { key: 'plan.why.backing', params: { key: COMMON_NAMES[jam.key] } },
    setup: { kind: 'backing', progressionId: jam.progressionId, key: jam.key, bpm: jam.bpm, style: jam.style },
  });

  return items.filter((it) => it.minutes > 0);
}

/** Bugün kaydedilen sonuçlara bakarak kendiliğinden tamamlanmış sayılan maddeler. */
export function autoDone(items: PlanItem[], input: Pick<PlanInput, 'today' | 'transitions' | 'rhythm'>): string[] {
  const done: string[] = [];
  for (const it of items) {
    if (it.setup.kind === 'transition') {
      const key = pairKey(it.setup.a, it.setup.b);
      if (input.transitions.some((r) => r.pair === key && dayKey(r.date) === input.today)) done.push(it.id);
    } else if (it.setup.kind === 'rhythm') {
      if (input.rhythm.some((r) => dayKey(r.date) === input.today)) done.push(it.id);
    }
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
