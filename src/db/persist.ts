import { signal, type Signal } from '@preact/signals';
import { kvGet, kvSet } from './db';

export interface Persistent<T extends object> {
  state: Signal<T>;
  /** Alanları günceller ve kaydeder. */
  update(patch: Partial<T>): void;
}

const loaders: (() => Promise<void>)[] = [];

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
      kvSet(key, state.value).catch((err) => console.warn(`[persist] ${key} yazılamadı`, err));
    },
  };
}

/** Uygulama açılışında, ilk çizimden önce tüm kalıcı durumları yükler. */
export async function loadPersistent(): Promise<void> {
  await Promise.all(loaders.map((l) => l()));
}
