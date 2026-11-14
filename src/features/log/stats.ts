/** Pratik günlüğü için saf hesaplar: gün anahtarları, seriler, toplamlar. */

export interface SessionRecord {
  id: string;
  type: 'session';
  /** Oturumun başladığı an (epoch ms). */
  date: number;
  seconds: number;
  /** Egzersiz türüne göre saniye. */
  activities: Record<string, number>;
  /** Uygulama dışında yapılan çalışma için elle eklendi. */
  manual?: boolean;
  [key: string]: unknown;
}

/** Bir günün seriye sayılması için gereken en az çalışma süresi. */
export const MIN_DAY_SECONDS = 60;
/** Bundan kısa oturumlar kaydedilmez. */
export const MIN_SESSION_SECONDS = 10;

const pad = (n: number) => String(n).padStart(2, '0');

/** Yerel saate göre gün anahtarı: "2026-11-14". */
export function dayKey(date: number | Date): string {
  const d = typeof date === 'number' ? new Date(date) : date;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(key: string, n: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Gün anahtarı → o günün toplam saniyesi. */
export function secondsByDay(sessions: SessionRecord[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const k = dayKey(s.date);
    map.set(k, (map.get(k) ?? 0) + s.seconds);
  }
  return map;
}

export interface DayTotal {
  key: string;
  seconds: number;
}

/** `todayKey` ile biten son `days` günün toplamları (eskiden yeniye). */
export function dailyTotals(sessions: SessionRecord[], days: number, todayKey: string): DayTotal[] {
  const byDay = secondsByDay(sessions);
  const out: DayTotal[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(todayKey, -i);
    out.push({ key, seconds: byDay.get(key) ?? 0 });
  }
  return out;
}

/** Belirtilen günden (dahil) itibaren egzersiz türüne göre toplam saniye, çoktan aza. */
export function activityTotals(sessions: SessionRecord[], fromKey: string): { activity: string; seconds: number }[] {
  const totals = new Map<string, number>();
  for (const s of sessions) {
    if (dayKey(s.date) < fromKey) continue;
    for (const [a, sec] of Object.entries(s.activities)) totals.set(a, (totals.get(a) ?? 0) + sec);
  }
  return [...totals.entries()]
    .map(([activity, seconds]) => ({ activity, seconds }))
    .filter((x) => x.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);
}

export interface Streaks {
  /** Bugün ya da dün biten kesintisiz gün sayısı. */
  current: number;
  longest: number;
  practicedToday: boolean;
}

export function streaks(sessions: SessionRecord[], todayKey: string, minSeconds = MIN_DAY_SECONDS): Streaks {
  const byDay = secondsByDay(sessions);
  const practiced = (k: string) => (byDay.get(k) ?? 0) >= minSeconds;
  const practicedToday = practiced(todayKey);

  // Bugün henüz çalışılmadıysa seri dünden sayılır: gün bitmeden seri bozulmuş görünmesin.
  let cursor = practicedToday ? todayKey : addDays(todayKey, -1);
  let current = 0;
  while (practiced(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }

  const keys = [...byDay.keys()].filter(practiced).sort();
  let longest = 0;
  let run = 0;
  let prev = '';
  for (const k of keys) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  return { current, longest: Math.max(longest, current), practicedToday };
}

export function totalSeconds(sessions: SessionRecord[], fromKey = ''): number {
  return sessions.reduce((sum, s) => (dayKey(s.date) >= fromKey ? sum + s.seconds : sum), 0);
}

/** Sayaç biçimi: "04:07" ya da "1:02:09". */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** Süre parçaları; birim adları arayüz dilinden gelir. */
export function durationParts(seconds: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.round(seconds));
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

export function isSessionRecord(v: unknown): v is SessionRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<SessionRecord>;
  return (
    typeof r.id === 'string' &&
    typeof r.date === 'number' &&
    typeof r.seconds === 'number' &&
    !!r.activities &&
    typeof r.activities === 'object'
  );
}

export interface ActiveSession {
  startedAt: number;
  seconds: number;
  activities: Record<string, number>;
  paused: boolean;
  /** Son sayım anı (epoch ms). */
  lastTick: number;
}

/** İki sayım arasında bundan uzun boşluk (uyku, gizli sekme) çalışma sayılmaz. */
export const MAX_TICK_GAP_MS = 5000;

/** Geçen süreyi etkin egzersize ekler (saf). */
export function accrue(session: ActiveSession, activity: string, now: number): ActiveSession {
  if (session.paused) return { ...session, lastTick: now };
  const delta = Math.min(MAX_TICK_GAP_MS, Math.max(0, now - session.lastTick)) / 1000;
  return {
    ...session,
    seconds: session.seconds + delta,
    activities: { ...session.activities, [activity]: (session.activities[activity] ?? 0) + delta },
    lastTick: now,
  };
}

/** Etkin oturumu kaydedilecek kayda çevirir; çok kısaysa null. */
export function toRecord(session: ActiveSession, id: string): SessionRecord | null {
  const seconds = Math.round(session.seconds);
  if (seconds < MIN_SESSION_SECONDS) return null;
  const activities: Record<string, number> = {};
  for (const [a, sec] of Object.entries(session.activities)) {
    if (Math.round(sec) > 0) activities[a] = Math.round(sec);
  }
  return { id, type: 'session', date: session.startedAt, seconds, activities };
}
