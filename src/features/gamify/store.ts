import { computed, effect, signal } from '@preact/signals';
import { dbAll, onDbWrite } from '../../db/db';
import { persistent } from '../../db/persist';
import { dayKey, type ActiveSession } from '../log/stats';
import { activeSession } from '../log/tracker';
import { buildGameData, diffNews, gameSnapshot, withActive, type GameData, type GameSnapshot, type QuestId } from './logic';

/**
 * Oyunlaştırmanın tek kalıcı durumu: hangi rozet/görev/seviye için bildirim gösterildi.
 * XP, rozet ve görevlerin kendisi her zaman kayıtlı veriden türetilir (`logic.ts`).
 */
interface Seen {
  /** null: bu özellik ilk kez açılıyor; o anki durum sessizce "görüldü" sayılır. */
  badges: string[] | null;
  questDay: string;
  quests: string[];
  level: number;
}

export const gameSeen = persistent<Seen>('gamify', { badges: null, questDay: '', quests: [], level: 0 });

/** Depolardan okunan veri (henüz okunmadıysa null). */
export const gameData = signal<GameData | null>(null);
/** Süren oturum, dakika çözünürlüğünde: her saniye yeniden hesaplanmasın diye. */
const liveSession = signal<ActiveSession | null>(null);
/** Gece yarısı geçince görevler yenilensin diye dakikada bir güncellenir. */
const today = signal(dayKey(Date.now()));

export const snapshot = computed<GameSnapshot | null>(() => {
  const data = gameData.value;
  return data ? gameSnapshot(withActive(data, liveSession.value), today.value) : null;
});

/** Hesaplamalarda kullanılan bugünün anahtarı. */
export function todayKey(): string {
  return today.value;
}

export async function reloadGameData(): Promise<void> {
  try {
    const [sessions, results, items] = await Promise.all([dbAll('sessions'), dbAll('results'), dbAll('items')]);
    today.value = dayKey(Date.now());
    gameData.value = buildGameData(sessions, results, items);
  } catch (err) {
    console.warn('[gamify] veri okunamadı', err);
    gameData.value ??= buildGameData([], [], []);
  }
}

// ---------------------------------------------------------------------------------------------
// Bildirimler

type ToastBody =
  | { kind: 'badge'; badge: string }
  | { kind: 'quest'; quest: QuestId }
  | { kind: 'level'; level: number }
  | { kind: 'many'; count: number };

export type Toast = ToastBody & { id: number };

export const toasts = signal<Toast[]>([]);
export const TOAST_MS = 4500;
/** Aynı anda bundan fazla haber varsa tek bir özet bildirim gösterilir. */
const MAX_TOASTS = 3;
let toastSeq = 0;

function showToasts(items: ToastBody[]): void {
  if (items.length === 0) return;
  const list: ToastBody[] = items.length > MAX_TOASTS ? [{ kind: 'many', count: items.length }] : items;
  const added: Toast[] = list.map((x) => ({ ...x, id: ++toastSeq }));
  toasts.value = [...toasts.value, ...added];
  for (const toast of added) {
    setTimeout(() => {
      toasts.value = toasts.value.filter((x) => x.id !== toast.id);
    }, TOAST_MS);
  }
}

/** Yeni durumu daha önce görülenle karşılaştırır; yeni rozet, görev ve seviyeler için bildirim gösterir. */
function announce(snap: GameSnapshot): void {
  const seen = gameSeen.state.peek();
  const earned = snap.badges.filter((b) => b.earned).map((b) => b.id);
  if (seen.badges === null) {
    gameSeen.update({
      badges: earned,
      questDay: snap.today,
      quests: snap.quests.filter((q) => q.done).map((q) => q.id),
      level: snap.level.level,
    });
    return;
  }
  const seenQuests = seen.questDay === snap.today ? seen.quests : [];
  const news = diffNews(snap, seen.badges, seenQuests);
  const levelUp = snap.level.level > seen.level;
  if (!news.badges.length && !news.quests.length && !levelUp && seen.questDay === snap.today) return;
  gameSeen.update({
    badges: [...seen.badges, ...news.badges],
    questDay: snap.today,
    quests: [...seenQuests, ...news.quests],
    level: Math.max(seen.level, snap.level.level),
  });
  showToasts([
    ...(levelUp ? [{ kind: 'level', level: snap.level.level } as const] : []),
    ...news.badges.map((badge) => ({ kind: 'badge', badge }) as const),
    ...news.quests.map((quest) => ({ kind: 'quest', quest }) as const),
  ]);
}

let started = false;

/** Uygulama açılışında bir kez: veriyi okur, yazmaları ve süren oturumu izler. */
export function startGameWatcher(): void {
  if (started) return;
  started = true;

  let timer: ReturnType<typeof setTimeout> | undefined;
  onDbWrite((store) => {
    if (store !== 'sessions' && store !== 'results' && store !== 'items') return;
    clearTimeout(timer);
    timer = setTimeout(() => void reloadGameData(), 200);
  });

  effect(() => {
    const s = activeSession.value;
    const prev = liveSession.peek();
    const minute = (x: ActiveSession | null) => (x ? Math.floor(x.seconds / 60) : -1);
    if (minute(s) !== minute(prev) || s?.startedAt !== prev?.startedAt) {
      liveSession.value = s && { ...s, seconds: Math.floor(s.seconds / 60) * 60 };
    }
  });

  setInterval(() => {
    today.value = dayKey(Date.now());
  }, 30_000);

  effect(() => {
    const snap = snapshot.value;
    if (snap) announce(snap);
  });

  void reloadGameData();
}
