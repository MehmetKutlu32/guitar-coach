import { useEffect } from 'preact/hooks';
import { FEATURES, findFeature } from './features/registry';
import { t } from './i18n';
import { href, route } from './router';
import { settings } from './settings';
import { Icon } from './ui/Icon';

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
        </header>
        <Screen key={current.id} />
      </main>
    </div>
  );
}
