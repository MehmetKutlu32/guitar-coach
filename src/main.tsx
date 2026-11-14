import { render } from 'preact';
import { App } from './app';
import { loadSettings } from './settings';
import './styles/app.css';

async function boot(): Promise<void> {
  await loadSettings();
  render(<App />, document.getElementById('app')!);

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    // Kapsam = uygulamanın yayınlandığı alt dizin (GitHub Pages'te /repo-adi/).
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((err) => console.warn('[sw] register failed', err));
  }
}

void boot();
