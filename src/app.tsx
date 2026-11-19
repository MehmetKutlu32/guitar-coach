import { useEffect } from 'preact/hooks';
import { clockText } from './features/log/stats';
import { GameToasts } from './features/gamify/Gamify';
import { activeSession } from './features/log/tracker';
import { FEATURES, findFeature } from './features/registry';
import { t } from './i18n';
import { href, route } from './router';
import { settings } from './settings';
import { Icon } from './ui/Icon';

/** Oturum sürerken her ekranda görünen küçük sayaç; günlüğe götürür. */
function SessionPill() {
  const s = activeSession.value;
  if (!s) return null;
  const text = clockText(s.seconds);
  return (
    <a
      class={`pill ${s.paused ? 'paused' : ''}`}
      href={href('log')}
      aria-label={t('log.pill', { d: text })}
      data-testid="session-pill"
    >
      <Icon name="timer" size={18} />
      <span>{text}</span>
    </a>
  );
}

export function App() {
  const current = findFeature(route.value.id);
  const lang = settings.lang.value;
  const title = current.id === 'home' ? t('app.name') : t(current.title);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = current.id === 'home' ? t('app.name') : `${t(current.title)} · ${t('app.name')}`;
  }, [lang, current.id]);

  const Screen = current.component;
  return (
    <div class="shell">
      <nav class="nav" aria-label={t('app.name')}>
        <div class="nav-brand">
          <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" width="32" height="32" />
          <span>{t('app.name')}</span>
        </div>
        {FEATURES.map((f) => (
          <a
            href={href(f.id)}
            class={`nav-link ${f.id === current.id ? 'active' : ''} ${f.primary ? '' : 'secondary'}`}
            aria-current={f.id === current.id ? 'page' : undefined}
            data-testid={`nav-${f.id}`}
          >
            <Icon name={f.icon} />
            <span>{t(f.title)}</span>
          </a>
        ))}
      </nav>
      <main class="main">
        <header class="topbar">
          <h1 data-testid="page-title">{title}</h1>
          <div class="topbar-actions">
            <SessionPill />
            <a
              class={`icon-link topbar-settings ${current.id === 'settings' ? 'active' : ''}`}
              href={href('settings')}
              aria-label={t('nav.settings')}
              data-testid="open-settings"
            >
              <Icon name="settings" />
            </a>
          </div>
        </header>
        <Screen key={current.id} />
      </main>
      <GameToasts />
    </div>
  );
}
