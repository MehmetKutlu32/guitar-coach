import { signal, type Signal } from '@preact/signals';
import { kvGet, kvSet } from './db';

export interface Persistent<T extends object> {
  state: Signal<T>;
  /** Alanları günceller ve kaydeder. */
  update(patch: Partial<T>): void;
}

const loaders: (() => Promise<void>)[] = [];
/** Yazmalar sırayla yapılır; böylece art arda gelen güncellemelerde son değer kalıcı olur. */
let pending: Promise<void> = Promise.resolve();

/**
 * Bir ekranın kalıcı durumu (ör. metronom ayarları). `kv` deposunda tek kayıt olarak tutulur.
 * Kayıtlı değer, varsayılanların üzerine yazılır; böylece yeni eklenen alanlar eski kayıtları bozmaz.
 */
export function persistent<T extends object>(key: string, defaults: T): Persistent<T> {
  const state = signal<T>(defaults);
  loaders.push(async () => {
    try {
      const saved = await kvGet<Partial<T>>(key);
      if (saved && typeof saved === 'object') state.value = { ...defaults, ...saved };
    } catch (err) {
      console.warn(`[persist] ${key} okunamadı`, err);
    }
  });
  return {
    state,
    update(patch) {
      state.value = { ...state.value, ...patch };
      queueWrite(key, state.value);
    },
  };
}

/** Bir anahtar/değer yazmasını sıraya ekler. */
export function queueWrite(key: string, value: unknown): void {
  pending = pending
    .then(() => kvSet(key, value))
    .catch((err) => console.warn(`[persist] ${key} yazılamadı`, err));
}

/** Bekleyen tüm yazmalar bitince çözülür. */
export function flushPersistent(): Promise<void> {
  return pending;
}

/** Uygulama açılışında, ilk çizimden önce tüm kalıcı durumları yükler. */
export async function loadPersistent(): Promise<void> {
  await Promise.all(loaders.map((l) => l()));
}
