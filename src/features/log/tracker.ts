import { signal } from '@preact/signals';
import { dbPut, kvGet, kvSet, newId } from '../../db/db';
import { accrue, toRecord, type ActiveSession, type SessionRecord } from './stats';

/** Süren çalışma oturumu (yoksa null). Ekranlar arası gezinmede korunur. */
export const activeSession = signal<ActiveSession | null>(null);
/** Oturum kayıtları değiştikçe artar; günlük ekranı yeniden okur. */
export const sessionsVersion = signal(0);

const KEY = 'activeSession';
let currentActivity = 'free';
let timer: ReturnType<typeof setInterval> | null = null;
let ticksSinceSave = 0;

function persist(): void {
  kvSet(KEY, activeSession.peek()).catch((err) => console.warn('[tracker] kaydedilemedi', err));
}

function tick(): void {
  const s = activeSession.peek();
  if (!s) return;
  activeSession.value = accrue(s, currentActivity, Date.now());
  if (++ticksSinceSave >= 10) {
    ticksSinceSave = 0;
    persist();
  }
}

function ensureTimer(): void {
  if (timer === null) timer = setInterval(tick, 1000);
}

function stopTimer(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

/** Süre bu egzersiz türüne yazılır (ekran değiştikçe uygulama kabuğu çağırır). */
export function setCurrentActivity(activity: string): void {
  // Önce o ana kadarki süreyi eski türe yaz.
  tick();
  currentActivity = activity;
}

export function startSession(): void {
  const now = Date.now();
  activeSession.value = { startedAt: now, seconds: 0, activities: {}, paused: false, lastTick: now };
  ticksSinceSave = 0;
  ensureTimer();
  persist();
}

export function pauseSession(): void {
  const s = activeSession.peek();
  if (!s || s.paused) return;
  activeSession.value = { ...accrue(s, currentActivity, Date.now()), paused: true };
  persist();
}

export function resumeSession(): void {
  const s = activeSession.peek();
  if (!s || !s.paused) return;
  activeSession.value = { ...s, paused: false, lastTick: Date.now() };
  ensureTimer();
  persist();
}

/** Oturumu bitirir ve kaydeder. Çok kısaysa kaydedilmez ve null döner. */
export async function finishSession(): Promise<SessionRecord | null> {
  const s = activeSession.peek();
  if (!s) return null;
  const final = accrue(s, currentActivity, Date.now());
  stopTimer();
  activeSession.value = null;
  await kvSet(KEY, null);
  const record = toRecord(final, newId());
  if (record) {
    await dbPut('sessions', record);
    sessionsVersion.value++;
  }
  return record;
}

/** Uygulama açılışında: yarım kalmış oturum varsa duraklatılmış olarak geri getirir. */
export async function restoreSession(): Promise<void> {
  try {
    const saved = await kvGet<ActiveSession | null>(KEY);
    if (saved && typeof saved.startedAt === 'number' && typeof saved.seconds === 'number') {
      activeSession.value = { ...saved, paused: true, lastTick: Date.now() };
      ensureTimer();
    }
  } catch (err) {
    console.warn('[tracker] geri yüklenemedi', err);
  }
}

if (typeof document !== 'undefined') {
  // Sekme gizlenirken son durumu yaz; sayfa kapanırsa süre kaybolmasın.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && activeSession.peek()) {
      tick();
      persist();
    }
  });
}
