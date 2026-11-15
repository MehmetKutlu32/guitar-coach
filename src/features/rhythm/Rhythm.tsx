import { useEffect, useState } from 'preact/hooks';
import { clampBpm, MAX_BPM, MIN_BPM } from '../../audio/clock';
import { inputStatus } from '../../audio/input';
import { dbAll } from '../../db/db';
import { persistent } from '../../db/persist';
import { fmtNumber, t, type Key } from '../../i18n';
import { href } from '../../router';
import { settings } from '../../settings';
import { DeviationChart, LineChart, TimingLane } from '../../ui/charts';
import { Card, LevelMeter, Notice, Segmented, Slider, Stepper } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { backingStore, resolveProgression } from '../backing/Backing';
import { isValidPattern, PRESET_PATTERNS, type StrumPattern } from '../metronome/patterns';
import { isRhythmResult, type RhythmResult } from './analysis';
import {
  resetRhythm,
  rhythmLive,
  rhythmOutcome,
  rhythmPhase,
  rhythmVersion,
  startRhythm,
  stopRhythm,
  type RhythmConfig,
} from './session';

interface RhythmState {
  source: 'metronome' | 'backing';
  bpm: number;
  bars: number;
  /** "div:1|2|3|4" ya da "pattern:<id>". */
  what: string;
}

export const rhythmStore = persistent<RhythmState>('rhythm', {
  source: 'metronome',
  bpm: 80,
  bars: 8,
  what: 'div:1',
});

const DIVISIONS = [1, 2, 3, 4];

function whatLabel(what: string, patterns: StrumPattern[]): string {
  if (what.startsWith('div:')) return t(`rhythm.div${what.slice(4)}` as Key);
  const p = patterns.find((x) => `pattern:${x.id}` === what);
  return p ? (p.nameKey ? t(p.nameKey) : p.name) : t('rhythm.div1');
}

function devText(ms: number): string {
  const r = Math.round(ms);
  if (Math.abs(r) <= 3) return t('rhythm.onTime');
  return r < 0 ? t('rhythm.early', { n: fmtNumber(-r) }) : t('rhythm.late', { n: fmtNumber(r) });
}

export function RhythmScreen() {
  const s = rhythmStore.state.value;
  const phase = rhythmPhase.value;
  const live = rhythmLive.value;
  const outcome = rhythmOutcome.value;
  const version = rhythmVersion.value;
  const lang = settings.lang.value;
  const status = inputStatus.value;
  const [custom, setCustom] = useState<StrumPattern[]>([]);
  const [history, setHistory] = useState<RhythmResult[]>([]);

  useEffect(() => {
    void dbAll('items', 'strum').then((rows) =>
      setCustom(
        (rows as unknown[])
          .filter(isValidPattern)
          .map((r) => ({ id: r.id, name: r.name, beats: r.beats, division: r.division, slots: r.slots, custom: true })),
      ),
    );
    return () => stopRhythm(false);
  }, []);

  useEffect(() => {
    void dbAll('results', 'rhythm').then((rows) =>
      setHistory((rows as unknown[]).filter(isRhythmResult).sort((a, b) => a.date - b.date)),
    );
  }, [version]);

  // Eşlikle çalışırken yalnızca 4 vuruşluk kalıplar kullanılabilir.
  const patterns = [...PRESET_PATTERNS, ...custom].filter((p) => p.beats === 4);
  const pattern = patterns.find((p) => `pattern:${p.id}` === s.what) ?? null;
  const division = s.what.startsWith('div:') ? Number(s.what.slice(4)) || 1 : 1;
  const beats = 4;
  const active = phase === 'starting' || phase === 'countin' || phase === 'running';

  const start = () => {
    const bs = backingStore.state.peek();
    const config: RhythmConfig = {
      source: s.source,
      bpm: s.bpm,
      bars: s.bars,
      division,
      pattern,
      what: s.what,
    };
    if (s.source === 'backing') {
      config.backing = {
        bars: resolveProgression(bs.progressionId, bs.key, []).bars,
        bpm: s.bpm,
        style: bs.style,
        loop: true,
        countIn: true,
        levels: { drums: bs.drums / 100, bass: bs.bass / 100, chords: bs.chords / 100 },
      };
    }
    void startRhythm(config);
  };

  const fmtDate = (d: number) =>
    new Date(d).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' });

  return (
    <div class="rhythm">
      <div class="stack">
        {active && (
          <Card testid="rhythm-run">
            <div class="tx-status" data-testid="rhythm-phase" data-phase={phase}>
              {phase === 'running' ? t('rhythm.barOf', { n: live.bar, total: s.bars }) : t('rhythm.countIn')}
            </div>
            <div class="beats">
              {Array.from({ length: beats }, (_, i) => (
                <span class={`beat-dot static ${i === 0 ? 'l2' : 'l1'} ${live.beat === i ? 'now' : ''}`}>{i + 1}</span>
              ))}
            </div>
            <TimingLane recent={live.recent} testid="lane" />
            <div class="lane-legend">
              <span>{t('rhythm.earlySide')}</span>
              <span>{t('rhythm.lateSide')}</span>
            </div>
            <div
              class={`rhythm-last ${live.last === null ? '' : Math.abs(live.last) <= 20 ? 'good' : 'warn'}`}
              data-testid="rhythm-last"
              data-dev={live.last === null ? '' : live.last.toFixed(1)}
            >
              {live.last === null ? t('rhythm.playNow') : devText(live.last)}
            </div>
            <p class="help center" data-testid="rhythm-hits">
              {t('rhythm.hitCount', { n: live.hits })}
            </p>
            <LevelMeter />
            <button type="button" class="btn block" onClick={() => stopRhythm(true)} data-testid="rhythm-stop">
              <Icon name="stop" /> {t('rhythm.finish')}
            </button>
          </Card>
        )}

        {phase === 'done' && outcome && (
          <Card title={t('rhythm.summary')} testid="rhythm-summary">
            <div class="scores">
              <div class="score">
                <span class="score-value" data-testid="score-accuracy">{outcome.result.accuracy}</span>
                <span class="stat-label">{t('rhythm.accuracy')}</span>
              </div>
              <div class="score">
                <span class="score-value" data-testid="score-consistency">{outcome.result.consistency}</span>
                <span class="stat-label">{t('rhythm.consistency')}</span>
              </div>
            </div>
            <Notice kind={outcome.analysis.tendency === 'ontime' ? 'good' : 'info'} testid="rhythm-tendency">
              {t(`rhythm.tendency.${outcome.analysis.tendency}` as Key, {
                n: fmtNumber(Math.abs(Math.round(outcome.result.meanMs))),
              })}
            </Notice>
            <div class="stats">
              <div class="stat">
                <span class="stat-value" data-testid="stat-mean">
                  {outcome.result.meanMs > 0 ? '+' : ''}
                  {fmtNumber(Math.round(outcome.result.meanMs))}
                </span>
                <span class="stat-label">{t('rhythm.meanMs')}</span>
              </div>
              <div class="stat">
                <span class="stat-value" data-testid="stat-abs">{fmtNumber(Math.round(outcome.result.absMs))}</span>
                <span class="stat-label">{t('rhythm.absMs')}</span>
              </div>
              <div class="stat">
                <span class="stat-value" data-testid="stat-missed">{outcome.result.missed}</span>
                <span class="stat-label">{t('rhythm.missed')}</span>
              </div>
              <div class="stat">
                <span class="stat-value" data-testid="stat-extra">{outcome.result.extra}</span>
                <span class="stat-label">{t('rhythm.extra')}</span>
              </div>
            </div>
            <DeviationChart deviations={outcome.result.deviations} title={t('rhythm.chart')} testid="dev-chart" />
            <p class="help center">{t('rhythm.chart')}</p>
            <button type="button" class="btn primary block big" onClick={resetRhythm} data-testid="rhythm-again">
              {t('rhythm.again')}
            </button>
          </Card>
        )}

        {!active && phase !== 'done' && (
          <Card testid="rhythm-setup">
            <p class="help">{t('rhythm.intro')}</p>
            <div class="field">
              <span class="field-label">{t('rhythm.source')}</span>
              <Segmented
                label={t('rhythm.source')}
                options={[
                  { value: 'metronome' as const, label: t('nav.metronome') },
                  { value: 'backing' as const, label: t('nav.backing') },
                ]}
                value={s.source}
                onChange={(source) => rhythmStore.update({ source })}
                testid="rhythm-source"
              />
            </div>
            <label class="field">
              <span class="field-label">{t('rhythm.what')}</span>
              <select
                class="select"
                value={pattern ? `pattern:${pattern.id}` : `div:${division}`}
                onChange={(e) => rhythmStore.update({ what: (e.target as HTMLSelectElement).value })}
                data-testid="rhythm-what"
              >
                <optgroup label={t('rhythm.notes')}>
                  {DIVISIONS.map((d) => (
                    <option value={`div:${d}`}>{t(`rhythm.div${d}` as Key)}</option>
                  ))}
                </optgroup>
                <optgroup label={t('metro.pattern')}>
                  {patterns.map((p) => (
                    <option value={`pattern:${p.id}`}>{p.nameKey ? t(p.nameKey) : p.name}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <div class="field">
              <span class="field-label">{t('backing.tempo')}</span>
              <Stepper
                label={t('backing.tempo')}
                value={s.bpm}
                min={MIN_BPM}
                max={MAX_BPM}
                step={5}
                onChange={(bpm) => rhythmStore.update({ bpm: clampBpm(bpm) })}
                format={(v) => `${v} BPM`}
                testid="rhythm-bpm"
              />
              <Slider
                label={t('backing.tempo')}
                value={s.bpm}
                min={MIN_BPM}
                max={MAX_BPM}
                onChange={(bpm) => rhythmStore.update({ bpm: clampBpm(bpm) })}
                testid="rhythm-bpm-slider"
              />
            </div>
            <div class="field">
              <span class="field-label">{t('rhythm.bars')}</span>
              <Segmented
                label={t('rhythm.bars')}
                options={[4, 8, 16].map((n) => ({ value: n, label: t('rhythm.barsN', { n }) }))}
                value={s.bars}
                onChange={(bars) => rhythmStore.update({ bars })}
                testid="rhythm-bars"
              />
            </div>
            <a class="list-row" href={href('settings')} data-testid="latency-link">
              <strong>{t('rhythm.latency', { n: settings.latencyMs.value })}</strong>
              <span class="dim">{settings.latencyCalibrated.value ? t('rhythm.latencyChange') : t('rhythm.latencyNeeded')}</span>
            </a>
            <p class="help">{t('rhythm.bleedHint')}</p>
            {status === 'denied' && <Notice kind="error">{t('input.denied')}</Notice>}
            {status === 'unavailable' && <Notice kind="error">{t('input.unavailable')}</Notice>}
            {status === 'error' && <Notice kind="error">{t('input.error')}</Notice>}
            <button type="button" class="btn primary block big" onClick={start} data-testid="rhythm-start">
              <Icon name="mic" /> {t('rhythm.start')}
            </button>
          </Card>
        )}
      </div>

      <Card title={t('rhythm.history')} testid="rhythm-history">
        {history.length === 0 ? (
          <p class="help" data-testid="rhythm-empty">{t('rhythm.noHistory')}</p>
        ) : (
          <>
            <LineChart
              title={t('rhythm.historyChart')}
              points={history.slice(-30).map((r) => ({ value: r.accuracy, label: fmtDate(r.date) }))}
              testid="rhythm-history-chart"
            />
            <p class="help center">{t('rhythm.historyChart')}</p>
            <div class="list">
              {history
                .slice(-8)
                .reverse()
                .map((r) => (
                  <div class="list-item" data-testid="rhythm-row">
                    <div class="list-item-main">
                      <strong>
                        {fmtDate(r.date)} · {r.bpm} BPM · {whatLabel(r.what, patterns)}
                      </strong>
                      <span class="dim">
                        {t('rhythm.rowStats', {
                          a: r.accuracy,
                          c: r.consistency,
                          m: fmtNumber(Math.round(r.absMs)),
                        })}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
