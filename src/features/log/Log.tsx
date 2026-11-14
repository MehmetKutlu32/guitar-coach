import { useEffect, useState } from 'preact/hooks';
import { dbAll, dbDelete, dbPut, newId } from '../../db/db';
import { t, type Key } from '../../i18n';
import { settings } from '../../settings';
import { BarChart } from '../../ui/charts';
import { Card, Notice, Segmented, Stepper } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import {
  activityTotals,
  addDays,
  clockText,
  dailyTotals,
  dayKey,
  durationParts,
  isSessionRecord,
  keyToDate,
  streaks,
  totalSeconds,
  type SessionRecord,
} from './stats';
import { activeSession, finishSession, pauseSession, resumeSession, sessionsVersion, startSession } from './tracker';

/** Günlükte kullanılan egzersiz türleri (özellik kaydındaki `activity` değerleri + serbest). */
export const ACTIVITIES = ['free', 'tuning', 'rhythm', 'chords'] as const;

export function activityName(id: string): string {
  const key = `activity.${id}` as Key;
  const name = t(key);
  return name === key ? id : name;
}

/** "1 sa 5 dk", "12 dk", "45 sn". */
export function durationText(seconds: number): string {
  const { h, m, s } = durationParts(seconds);
  if (h > 0) return `${h} ${t('dur.h')} ${m} ${t('dur.m')}`;
  if (m > 0) return `${m} ${t('dur.m')}`;
  return `${s} ${t('dur.s')}`;
}

/** `undefined` = gösterilecek mesaj yok, `null` = oturum çok kısaydı, kayıt = kaydedildi. */
type SaveOutcome = SessionRecord | null | undefined;

function SessionCard(props: { onSaved: (r: SaveOutcome) => void }) {
  const s = activeSession.value;
  const top = s ? Object.entries(s.activities).sort((a, b) => b[1] - a[1]) : [];
  return (
    <Card title={t('log.session')} testid="session">
      <div class={`session-clock ${s && !s.paused ? 'running' : ''}`} data-testid="session-clock">
        {clockText(s?.seconds ?? 0)}
      </div>
      {s ? (
        <>
          <div class="session-state" data-testid="session-state">
            {s.paused ? t('log.paused') : t('log.runningHint')}
          </div>
          {top.length > 0 && (
            <div class="chips" data-testid="session-activities">
              {top.map(([a, sec]) => (
                <span class="tag">
                  {activityName(a)} · {clockText(sec)}
                </span>
              ))}
            </div>
          )}
          <div class="row">
            {s.paused ? (
              <button type="button" class="btn primary grow big" onClick={resumeSession} data-testid="session-resume">
                <Icon name="play" /> {t('log.resume')}
              </button>
            ) : (
              <button type="button" class="btn grow big" onClick={pauseSession} data-testid="session-pause">
                {t('log.pause')}
              </button>
            )}
            <button
              type="button"
              class="btn grow big"
              onClick={async () => props.onSaved(await finishSession())}
              data-testid="session-finish"
            >
              <Icon name="check" /> {t('log.finish')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="help center">{t('log.sessionHelp')}</p>
          <button
            type="button"
            class="btn primary block big"
            onClick={() => {
              props.onSaved(undefined);
              startSession();
            }}
            data-testid="session-start"
          >
            <Icon name="timer" /> {t('log.start')}
          </button>
        </>
      )}
    </Card>
  );
}

function ManualForm(props: { onDone: () => void }) {
  const today = dayKey(Date.now());
  const [date, setDate] = useState(today);
  const [minutes, setMinutes] = useState(20);
  const [activity, setActivity] = useState<string>('free');
  const save = async () => {
    const day = date && date <= today ? date : today;
    await dbPut('sessions', {
      id: newId(),
      type: 'session',
      date: keyToDate(day).getTime(),
      seconds: minutes * 60,
      activities: { [activity]: minutes * 60 },
      manual: true,
    });
    sessionsVersion.value++;
    props.onDone();
  };
  return (
    <div class="editor" data-testid="manual-form">
      <label class="field">
        <span class="field-label">{t('log.manualDate')}</span>
        <input
          class="input"
          type="date"
          value={date}
          max={today}
          onInput={(e) => setDate((e.target as HTMLInputElement).value)}
          data-testid="manual-date"
        />
      </label>
      <div class="field">
        <span class="field-label">{t('log.manualMinutes')}</span>
        <Stepper
          label={t('log.manualMinutes')}
          value={minutes}
          min={5}
          max={600}
          step={5}
          onChange={setMinutes}
          format={(v) => `${v} ${t('dur.m')}`}
          testid="manual-minutes"
        />
      </div>
      <label class="field">
        <span class="field-label">{t('log.manualActivity')}</span>
        <select
          class="select"
          value={activity}
          onChange={(e) => setActivity((e.target as HTMLSelectElement).value)}
          data-testid="manual-activity"
        >
          {ACTIVITIES.map((a) => (
            <option value={a}>{activityName(a)}</option>
          ))}
        </select>
      </label>
      <div class="row">
        <button type="button" class="btn primary grow" onClick={save} data-testid="manual-save">
          {t('common.save')}
        </button>
        <button type="button" class="btn grow" onClick={props.onDone}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

export function LogScreen() {
  const version = sessionsVersion.value;
  const lang = settings.lang.value;
  const locale = lang === 'tr' ? 'tr-TR' : 'en-US';
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [range, setRange] = useState<7 | 30>(7);
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<SaveOutcome>(undefined);
  // Süren oturumun süresi "bugün" toplamına canlı eklenir.
  const live = activeSession.value;

  useEffect(() => {
    void dbAll('sessions').then((rows) =>
      setSessions((rows as unknown[]).filter(isSessionRecord).sort((a, b) => b.date - a.date)),
    );
  }, [version]);

  const today = dayKey(Date.now());
  const st = streaks(sessions, today);
  const days = dailyTotals(sessions, range, today);
  const fromKey = addDays(today, -(range - 1));
  const breakdown = activityTotals(sessions, fromKey);
  const breakdownMax = breakdown[0]?.seconds ?? 1;
  const todaySeconds = (days[days.length - 1]?.seconds ?? 0) + (live?.seconds ?? 0);
  const weekSeconds = totalSeconds(sessions, addDays(today, -6));

  const label = (key: string) =>
    range === 7
      ? keyToDate(key).toLocaleDateString(locale, { weekday: 'short' })
      : String(keyToDate(key).getDate());

  const remove = async (id: string) => {
    if (!confirm(t('log.deleteConfirm'))) return;
    await dbDelete('sessions', id);
    sessionsVersion.value++;
  };

  return (
    <div class="log">
      <div class="stack">
        <SessionCard onSaved={setMessage} />
        {message === null && <Notice testid="session-message">{t('log.tooShort')}</Notice>}
        {message && (
          <Notice kind="good" testid="session-message">
            {t('log.savedSession', { d: durationText(message.seconds) })}
          </Notice>
        )}

        <Card testid="streak">
          <div class="stats">
            <div class="stat accent">
              <span class="stat-value" data-testid="streak-current">{st.current}</span>
              <span class="stat-label">{t('log.streak')}</span>
            </div>
            <div class="stat">
              <span class="stat-value" data-testid="streak-longest">{st.longest}</span>
              <span class="stat-label">{t('log.longest')}</span>
            </div>
            <div class="stat">
              <span class="stat-value small" data-testid="today-total">{durationText(todaySeconds)}</span>
              <span class="stat-label">{t('log.today')}</span>
            </div>
            <div class="stat">
              <span class="stat-value small" data-testid="week-total">{durationText(weekSeconds)}</span>
              <span class="stat-label">{t('log.week7')}</span>
            </div>
          </div>
          <p class="help center" data-testid="streak-hint">
            {st.practicedToday ? t('log.streakDone') : st.current > 0 ? t('log.streakKeep') : t('log.streakStart')}
          </p>
        </Card>
      </div>

      <div class="stack">
        <Card title={t('log.chart')} testid="log-chart-card">
          <Segmented
            label={t('log.chart')}
            options={[
              { value: 7 as const, label: t('log.week') },
              { value: 30 as const, label: t('log.month') },
            ]}
            value={range}
            onChange={setRange}
            testid="log-range"
          />
          <BarChart
            title={t('log.chartTitle')}
            points={days.map((d) => ({ value: Math.round(d.seconds / 6) / 10, label: label(d.key) }))}
            highlightLast
            testid="log-chart"
          />
          <p class="help center">{t('log.chartTitle')}</p>
          {breakdown.length > 0 && (
            <div class="field" data-testid="breakdown">
              <span class="field-label">{t('log.byActivity')}</span>
              {breakdown.map((b) => (
                <div class="hbar" data-testid={`breakdown-${b.activity}`}>
                  <div class="hbar-head">
                    <span>{activityName(b.activity)}</span>
                    <span class="dim">{durationText(b.seconds)}</span>
                  </div>
                  <div class="hbar-track">
                    <div class="hbar-fill" style={{ width: `${Math.max(2, (b.seconds / breakdownMax) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title={t('log.recent')} testid="recent">
          {adding ? (
            <ManualForm onDone={() => setAdding(false)} />
          ) : (
            <>
              {sessions.length === 0 && <p class="help" data-testid="log-empty">{t('log.noData')}</p>}
              <div class="list">
                {sessions.slice(0, 30).map((s) => (
                  <div class="list-item" data-testid="session-row">
                    <div class="list-item-main">
                      <strong>
                        {new Date(s.date).toLocaleDateString(locale, { day: 'numeric', month: 'long', weekday: 'short' })}
                        {' · '}
                        {durationText(s.seconds)}
                      </strong>
                      <span class="dim">
                        {Object.entries(s.activities)
                          .sort((a, b) => b[1] - a[1])
                          .map(([a, sec]) => `${activityName(a)} ${durationText(sec)}`)
                          .join(' · ')}
                        {s.manual ? ` · ${t('log.manualTag')}` : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      class="btn icon-only danger"
                      aria-label={t('log.deleteSession')}
                      onClick={() => remove(s.id)}
                      data-testid="session-delete"
                    >
                      <Icon name="trash" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" class="btn block" onClick={() => setAdding(true)} data-testid="manual-add">
                <Icon name="plus" /> {t('log.addManual')}
              </button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
