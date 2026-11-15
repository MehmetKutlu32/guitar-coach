import { effect, signal, type Signal } from '@preact/signals';
import { kvGet } from './db/db';
import { queueWrite } from './db/persist';

export type Lang = 'tr' | 'en';

/** Kalıcı kullanıcı ayarları. Her biri bir sinyal; değişince IndexedDB'ye yazılır. */
export const settings = {
  lang: signal<Lang>('tr'),
  inputDeviceId: signal(''),
  /** A4 referans frekansı (Hz). */
  a4: signal(440),
  tuningId: signal('standard'),
  /** Çıkış + giriş toplam gecikmesi (ms): ritim ölçümünde vuruş zamanlarından düşülür. */
  latencyMs: signal(0),
  /** Kullanıcı gecikmeyi en az bir kez ölçtü ya da elle ayarladı. */
  latencyCalibrated: signal(false),
};

type SettingsShape = typeof settings;
export type SettingsSnapshot = { [K in keyof SettingsShape]: SettingsShape[K] extends Signal<infer V> ? V : never };

export function snapshotSettings(): SettingsSnapshot {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(settings)) out[k] = s.value;
  return out as SettingsSnapshot;
}

export function applySettings(saved: Partial<SettingsSnapshot> | undefined): void {
  if (!saved) return;
  for (const [k, s] of Object.entries(settings) as [keyof SettingsSnapshot, Signal<unknown>][]) {
    const v = saved[k];
    if (v !== undefined && typeof v === typeof s.peek()) s.value = v;
  }
}

let started = false;

/** Kayıtlı ayarları yükler ve değişiklikleri kalıcı hale getirmeye başlar. */
export async function loadSettings(): Promise<void> {
  try {
    applySettings(await kvGet<Partial<SettingsSnapshot>>('settings'));
  } catch (err) {
    console.warn('[settings] load failed', err);
  }
  if (started) return;
  started = true;
  let first = true;
  effect(() => {
    const snap = snapshotSettings();
    if (first) {
      first = false;
      return;
    }
    queueWrite('settings', snap);
  });
}
