import { t } from '../../i18n';
import { href, route } from '../../router';
import { Icon } from '../../ui/Icon';
import { LevelTest, TodayPlan } from '../plan/Plan';
import { FEATURES } from '../registry';

export function Home() {
  if (route.value.rest[0] === 'test') return <LevelTest />;
  const tools = FEATURES.filter((f) => f.tool);
  return (
    <div class="stack">
      <p class="lead">{t('app.tagline')}</p>
      <TodayPlan />
      <section>
        <h2 class="section-title">{t('home.tools')}</h2>
        <div class="tool-grid" data-testid="tool-grid">
          {tools.map((f) => (
            <a class="tool-card" href={href(f.id)} data-testid={`tool-${f.id}`}>
              <span class="tool-icon">
                <Icon name={f.icon} size={28} />
              </span>
              <span class="tool-text">
                <strong>{t(f.title)}</strong>
                {f.desc && <span>{t(f.desc)}</span>}
              </span>
              <Icon name="chevron" size={20} />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}
