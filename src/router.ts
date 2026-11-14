import { signal } from '@preact/signals';

export interface Route {
  /** Özellik kimliği, ör. "tuner". Boşsa ana sayfa. */
  id: string;
  /** Kalan yol parçaları. */
  rest: string[];
}

function parse(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));
  return { id: parts[0] ?? 'home', rest: parts.slice(1) };
}

/** Hash tabanlı yönlendirme: GitHub Pages'te sunucu ayarı gerektirmez. */
export const route = signal<Route>(parse(typeof location === 'undefined' ? '' : location.hash));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = parse(location.hash);
    window.scrollTo(0, 0);
  });
}

export function href(id: string, ...rest: string[]): string {
  return '#/' + [id, ...rest].map(encodeURIComponent).join('/');
}

export function navigate(id: string, ...rest: string[]): void {
  location.hash = href(id, ...rest);
}
