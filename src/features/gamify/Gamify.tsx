import { useMemo } from 'preact/hooks';
import { fmtNumber, t, type Key } from '../../i18n';
import { href } from '../../router';
import { settings } from '../../settings';
import { BarChart } from '../../ui/charts';
import { Card, Notice } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { keyToDate } from '../log/stats';
import { theoryStore } from '../theory/Theory';
import {
  BADGE_GROUPS,
  BADGES,
  badgeDates,
  QUESTS,
  QUESTS_PER_DAY,
  rankFor,
  XP,
  XP_SOURCES,
  xpHistory,
  xpTotalsBySource,
  type BadgeState,
  type GameSnapshot,
  type QuestId,
  type QuestState,
  type QuestUnit,
} from './logic';
import { gameData, snapshot, toasts, type Toast } from './store';

const HISTORY_DAYS = 14;

function unitText(value: number, target: number, unit: QuestUnit): string {
  const key: Key = unit === 'min' ? 'gamify.unit.min' : unit === 'percent' ? 'gamify.unit.percent' : 'gamify.unit.count';
  return t(key, { v: fmtNumber(Math.min(value, target)), t: fmtNumber(target) });
}

const pct = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;

/** Görevin ilgili araca götüren bağlantısı. */
const QUEST_ROUTE: Record<QuestId, string> = {
  practice15: 'log',
  practice30: 'log',
  transition: 'chords',
  transition3: 'chords',
  rhythm: 'rhythm',
  rhythmGood: 'rhythm',
  ear2: 'ear',
  fretgame: 'theory',
  variety: 'log',
  record: 'record',
  song10: 'songs',
};

const questName = (id: QuestId) => t(`gamify.quest.${id}` as Key);
const badgeName = (id: string) => t(`gamify.badge.${id}` as Key);

function LevelHeader({ snap }: { snap: GameSnapshot }) {
  const { level } = snap;
  return (
    <div class="game-level" data-testid="game-level">
      <div class="game-level-badge" aria-hidden="true">
        <small>{t('gamify.levelShort')}</small>
        <strong>{level.level}</strong>
      </div>
      <div class="game-level-main">
        <div class="game-level-head">
          <strong data-testid="game-level-text">
            {t('gamify.level', { n: level.level })} · {t(`gamify.rank.${rankFor(level.level)}` as Key)}
          </strong>
          <span class="game-today" data-testid="game-today-xp">
            {t('gamify.todayXp', { n: fmtNumber(snap.todayXp) })}
          </span>
        </div>
        <div
          class="hbar-track game-xp-track"
          role="progressbar"
          aria-label={t('gamify.toNext', { n: fmtNumber(level.remaining) })}
          aria-valuemin={0}
          aria-valuemax={level.next - level.floor}
          aria-valuenow={level.into}
        >
          <div class="hbar-fill" style={{ width: pct(level.progress) }} />
        </div>
        <div class="game-xp-text">
          <span data-testid="game-xp">{t('gamify.xp', { n: fmtNumber(level.xp) })}</span>
          <span>{t('gamify.toNext', { n: fmtNumber(level.remaining) })}</span>
        </div>
      </div>
    </div>
  );
}

function QuestRow({ q }: { q: QuestState }) {
  const def = QUESTS[q.id];
  return (
    <a
      class={`quest ${q.done ? 'done' : ''}`}
      href={href(QUEST_ROUTE[q.id])}
      onClick={() => {
        if (q.id === 'fretgame') theoryStore.update({ view: 'game' });
      }}
      data-testid={`quest-${q.id}`}
      data-done={q.done ? 'true' : 'false'}
    >
      <span class="quest-icon">
        <Icon name={q.done ? 'check' : def.icon} size={22} />
      </span>
      <span class="quest-main">
        <strong>{questName(q.id)}</strong>
        <span class="hbar-track">
          <span class="hbar-fill" style={{ width: pct(q.value / q.target) }} />
        </span>
      </span>
      <span class="quest-value" data-testid={`quest-${q.id}-value`}>
        {q.done ? t('gamify.xpGain', { n: XP.quest }) : unitText(q.value, q.target, def.unit)}
      </span>
    </a>
  );
}

function QuestList({ snap }: { snap: GameSnapshot }) {
  const done = snap.quests.filter((q) => q.done).length;
  return (
    <>
      <div class="quest-list" data-testid="quest-list">
        {snap.quests.map((q) => (
          <QuestRow q={q} />
        ))}
      </div>
      {done === QUESTS_PER_DAY ? (
        <Notice kind="good" testid="quests-all-done">
          {t('gamify.questsAll', { n: XP.allQuests })}
        </Notice>
      ) : (
        <p class="help" data-testid="quests-progress">
          {t('gamify.questsDone', { done, total: QUESTS_PER_DAY })}
        </p>
      )}
    </>
  );
}

/** Ana sayfadaki küçük kart: seviye, XP çubuğu, bugünün görevleri. */
export function GameCard() {
  const snap = snapshot.value;
  if (!snap) return null;
  return (
    <Card title={t('gamify.card')} class="game-card" testid="game-card">
      <LevelHeader snap={snap} />
      <h3 class="game-sub">{t('gamify.quests')}</h3>
      <QuestList snap={snap} />
      <a class="btn block" href={href('progress')} data-testid="game-open">
        <Icon name="trophy" /> {t('gamify.open')}
      </a>
    </Card>
  );
}

function BadgeTile({ b, date }: { b: BadgeState; date?: string }) {
  const def = BADGES.find((x) => x.id === b.id)!;
  const lang = settings.lang.value;
  const when = date
    ? keyToDate(date).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })
    : '';
  return (
    <div class={`badge-tile ${b.earned ? 'earned' : 'locked'}`} data-testid={`badge-${b.id}`} data-earned={b.earned ? 'true' : 'false'}>
      <span class="badge-icon">
        <Icon name={b.earned ? def.icon : 'lock'} size={26} />
      </span>
      <span class="badge-text">
        <strong>{badgeName(b.id)}</strong>
        <span class="dim">{t(`gamify.badge.${b.id}.desc` as Key)}</span>
        {b.earned ? (
          when && <span class="badge-when">{t('gamify.earnedOn', { d: when })}</span>
        ) : (
          <span class="badge-progress">
            <span class="hbar-track">
              <span class="hbar-fill" style={{ width: pct(b.progress) }} />
            </span>
            <span class="dim">{unitText(b.value, b.target, def.unit)}</span>
          </span>
        )}
      </span>
    </div>
  );
}

/** "Başarılar" ekranı: seviye, görevler, XP geçmişi ve tüm rozetler. */
export function ProgressScreen() {
  const snap = snapshot.value;
  const data = gameData.value;
  // Kazanılma günleri yalnızca kayıtlı veriden (süren oturum hariç) ve yalnızca bu ekranda hesaplanır.
  const today = snap?.today ?? '';
  const dates = useMemo(() => (data ? badgeDates(data, today) : new Map<string, string>()), [data, today]);
  if (!snap) return null;

  const earned = snap.badges.filter((b) => b.earned).length;
  const history = xpHistory(snap.days, snap.today, HISTORY_DAYS);
  const sources = xpTotalsBySource(snap.days);
  const maxSource = Math.max(1, ...XP_SOURCES.map((s) => sources[s]));

  return (
    <div class="stack game" data-testid="progress-screen">
      <Card title={t('gamify.levelTitle')} testid="game-summary">
        <LevelHeader snap={snap} />
        <div class="stats">
          <div class="stat">
            <span class="stat-value" data-testid="game-total-xp">
              {fmtNumber(snap.xp)}
            </span>
            <span class="stat-label">{t('gamify.totalXp')}</span>
          </div>
          <div class="stat">
            <span class="stat-value">{fmtNumber(snap.todayXp)}</span>
            <span class="stat-label">{t('gamify.today')}</span>
          </div>
          <div class="stat">
            <span class="stat-value">{snap.streak}</span>
            <span class="stat-label">{t('gamify.streak')}</span>
          </div>
          <div class="stat">
            <span class="stat-value" data-testid="game-badge-count">
              {earned}
            </span>
            <span class="stat-label">{t('gamify.badgesLabel')}</span>
          </div>
        </div>
      </Card>

      <Card title={t('gamify.quests')} testid="game-quests">
        <QuestList snap={snap} />
        <p class="help">{t('gamify.questsHelp')}</p>
      </Card>

      <Card title={t('gamify.history')} testid="game-history">
        <BarChart
          points={history.map((d) => ({ value: d.xp, label: String(keyToDate(d.key).getDate()) }))}
          title={t('gamify.historyTitle', { n: HISTORY_DAYS })}
          testid="game-history-chart"
          highlightLast
        />
        <p class="help center">{t('gamify.historyTitle', { n: HISTORY_DAYS })}</p>
        <h3 class="game-sub">{t('gamify.bySource')}</h3>
        <div class="list" data-testid="game-sources">
          {XP_SOURCES.map((s) => (
            <div class="hbar" data-testid={`game-source-${s}`}>
              <div class="hbar-head">
                <span>{t(`gamify.source.${s}` as Key)}</span>
                <span>{t('gamify.xp', { n: fmtNumber(sources[s]) })}</span>
              </div>
              <div class="hbar-track">
                <div class="hbar-fill" style={{ width: pct(sources[s] / maxSource) }} />
              </div>
            </div>
          ))}
        </div>
        <details class="game-howto">
          <summary>{t('gamify.howTo')}</summary>
          <p class="help">{t('gamify.howToText')}</p>
        </details>
      </Card>

      <Card title={t('gamify.badges')} testid="game-badges">
        <p class="lead" data-testid="game-badges-earned">
          {t('gamify.badgesEarned', { n: earned, total: snap.badges.length })}
        </p>
        {BADGE_GROUPS.map((g) => (
          <section class="badge-group" data-testid={`badge-group-${g}`}>
            <h3 class="game-sub">{t(`gamify.group.${g}` as Key)}</h3>
            <div class="badge-grid">
              {snap.badges
                .filter((b) => BADGES.find((x) => x.id === b.id)!.group === g)
                .map((b) => (
                  <BadgeTile b={b} date={dates.get(b.id)} />
                ))}
            </div>
          </section>
        ))}
      </Card>
    </div>
  );
}

function toastText(toast: Toast): string {
  switch (toast.kind) {
    case 'badge':
      return t('gamify.toast.badge', { name: badgeName(toast.badge) });
    case 'quest':
      return t('gamify.toast.quest', { name: questName(toast.quest), xp: XP.quest });
    case 'level':
      return t('gamify.toast.level', { n: toast.level });
    case 'many':
      return t('gamify.toast.many', { n: toast.count });
  }
}

/** Yeni rozet, görev ya da seviye bildirimi. Dokunmayı engellemez; birkaç saniye sonra kaybolur. */
export function GameToasts() {
  const list = toasts.value;
  return (
    <div class="toasts" role="status" aria-live="polite" data-testid="toasts">
      {list.map((x) => (
        <div class={`toast toast-${x.kind}`} data-testid={`toast-${x.kind}`}>
          <Icon name={x.kind === 'quest' ? 'check' : 'trophy'} size={22} />
          <span>{toastText(x)}</span>
        </div>
      ))}
    </div>
  );
}
