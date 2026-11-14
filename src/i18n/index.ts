import { settings, type Lang } from '../settings';
import { en } from './en';
import { tr, type Key } from './tr';

export type { Key } from './tr';

export const dictionaries: Record<Lang, Record<Key, string>> = { tr, en };

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'English' },
];

/** Çeviri. Bileşen içinde çağrılınca dil sinyaline abone olur; dil değişince arayüz yenilenir. */
export function t(key: Key, params?: Record<string, string | number>): string {
  let s: string = dictionaries[settings.lang.value][key] ?? tr[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

/** Sayıyı geçerli dile göre biçimlendirir. */
export function fmtNumber(n: number, digits = 0): string {
  return n.toLocaleString(settings.lang.value === 'tr' ? 'tr-TR' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
