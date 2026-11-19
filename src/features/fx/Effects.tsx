import { useEffect, useState } from 'preact/hooks';
import { inputStatus } from '../../audio/input';
import { dbAll, dbDelete, dbPut, newId } from '../../db/db';
import { persistent } from '../../db/persist';
import { DELAY_DIVISIONS, delaySeconds, type DelayDivision } from '../../dsp/fx';
import { fmtNumber, t, type Key } from '../../i18n';
import { settings } from '../../settings';
import { Card, LevelMeter, Notice, Segmented, Slider, Toggle } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { metroStore } from '../metronome/Metronome';
import { DRIVE_LATENCY_SAMPLES } from './chain';
import { fxClip, fxLive, fxOutLevel, reportedLatency, setFxMuted, startFx, stopFx, updateFx } from './live';
import {
  BUILTIN_PRESETS,
  DEFAULT_INPUT,
  DEFAULT_PRESET,
  DEFAULT_VOLUME,
  estimateLatency,
  GAIN_RANGE,
  GATE_RANGE,
  isUserPreset,
  presetName,
  sanitizeInput,
  sanitizePreset,
  type FxPreset,
  type InputParams,
  type UserPreset,
} from './logic';

interface FxState {
  preset: FxPreset;
  /** Seçili hazır ses (yerleşik kimlik ya da kullanıcı kaydının kimliği); ayar değişince ''. */
  presetId: string;
  input: InputParams;
  volume: number;
}

export const fxStore = persistent<FxState>('fx', {
  preset: DEFAULT_PRESET,
  presetId: 'clean',
  input: DEFAULT_INPUT,
  volume: DEFAULT_VOLUME,
});

/** Ekran açılırken ana ses en fazla bu kadar olur (önceki oturumda çok açık bırakılmışsa). */
const OPEN_VOLUME_CAP = 50;

function current(): { preset: FxPreset; input: InputParams; volume: number; bpm: number } {
  const s = fxStore.state.value;
  return {
    preset: sanitizePreset(s.preset),
    input: sanitizeInput(s.input),
    volume: Math.min(100, Math.max(0, s.volume)),
    bpm: metroStore.state.value.bpm,
  };
}

function Knob(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  testid: string;
}) {
  return (
    <div class="fx-knob">
      <div class="fx-knob-head">
        <span class="field-label">{props.label}</span>
        <output class="fx-knob-value" data-testid={`${props.testid}-value`}>
          {props.format(props.value)}
        </output>
      </div>
      <Slider
        label={props.label}
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={props.onChange}
        testid={props.testid}
      />
    </div>
  );
}

function OutputMeter() {
  const level = fxOutLevel.value;
  const clip = fxClip.value;
  return (
    <div class="fx-meter-row">
      <div
        class="meter grow"
        role="meter"
        aria-label={t('fx.outLevel')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        data-testid="fx-out-meter"
      >
        <div class={`meter-fill ${level > 0.95 ? 'hot' : ''}`} style={{ transform: `scaleX(${level})` }} />
      </div>
      <span class={`fx-clip ${clip ? 'on' : ''}`} data-testid="fx-clip" data-on={clip ? 'true' : 'false'}>
        {t('fx.clip')}
      </span>
    </div>
  );
}

function LatencyBox(props: { running: boolean; driveOn: boolean }) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!props.running) return;
    const id = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [props.running]);
  void now;
  const calibrated = settings.latencyCalibrated.value ? settings.latencyMs.value : null;
  if (!props.running && calibrated === null) {
    return (
      <div class="fx-latency" data-testid="fx-latency" data-ms="">
        <span class="field-label">{t('fx.latency')}</span>
        <p class="help">{t('fx.latencyIdle')}</p>
      </div>
    );
  }
  const r = props.running ? reportedLatency() : { base: 0, output: 0, input: null, sampleRate: 48000 };
  const est = estimateLatency({
    base: r.base,
    output: r.output,
    input: r.input,
    chain: props.driveOn ? DRIVE_LATENCY_SAMPLES / r.sampleRate : 0,
    calibratedMs: calibrated,
  });
  const ms = (s: number) => fmtNumber(s * 1000, 1);
  return (
    <div class={`fx-latency ${est.rating}`} data-testid="fx-latency" data-ms={est.ms} data-rating={est.rating}>
      <div class="fx-latency-head">
        <span class="field-label">{t('fx.latency')}</span>
        <strong class="fx-latency-value">≈ {est.ms} ms</strong>
      </div>
      <p class="fx-latency-rating" data-testid="fx-latency-rating">
        {t(`fx.latency.${est.rating}` as Key)}
      </p>
      <p class="help">
        {est.source === 'calibrated' ? t('fx.latencyCalibrated', { n: calibrated ?? 0 }) : t('fx.latencyReported')}
        {props.running && (
          <>
            {' '}
            {t('fx.latencyParts', {
              i: r.input === null ? `≈${ms(r.base)}` : ms(r.input),
              b: ms(r.base),
              o: ms(r.output),
            })}
          </>
        )}
      </p>
    </div>
  );
}

export function EffectsScreen() {
  const live = fxLive.value;
  const status = inputStatus.value;
  const state = fxStore.state.value;
  const { preset, input, volume, bpm } = current();
  const [userPresets, setUserPresets] = useState<UserPreset[]>([]);
  const [naming, setNaming] = useState<string | null>(null);

  const loadPresets = async () => {
    const rows = ((await dbAll('items', 'fxpreset')) as unknown[]).filter(isUserPreset).sort((a, b) => a.date - b.date);
    setUserPresets(rows);
  };

  useEffect(() => {
    if (fxStore.state.peek().volume > OPEN_VOLUME_CAP) fxStore.update({ volume: OPEN_VOLUME_CAP });
    void loadPresets();
    return () => stopFx();
  }, []);

  // Ayar değişince çalışan zincire uygula.
  useEffect(() => {
    updateFx({ preset, input, volume, bpm });
  }, [JSON.stringify(preset), JSON.stringify(input), volume, bpm]);

  const setPreset = (p: FxPreset) => fxStore.update({ preset: sanitizePreset(p), presetId: '' });
  const patch = <K extends keyof FxPreset>(key: K, value: Partial<FxPreset[K]>) =>
    setPreset({ ...preset, [key]: { ...preset[key], ...value } });
  const setInput = (value: Partial<InputParams>) => fxStore.update({ input: sanitizeInput({ ...input, ...value }) });

  const choose = (id: string, p: FxPreset) => {
    fxStore.update({ preset: sanitizePreset(p), presetId: id });
    setNaming(null);
  };

  const savePreset = async () => {
    const name = presetName(naming ?? '');
    if (!name) return;
    const existing = userPresets.find((u) => u.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    const record: UserPreset = { id: existing?.id ?? newId(), type: 'fxpreset', date: existing?.date ?? Date.now(), name, preset };
    await dbPut('items', record);
    await loadPresets();
    fxStore.update({ presetId: record.id });
    setNaming(null);
  };

  const removePreset = async (u: UserPreset) => {
    if (!confirm(t('fx.deleteConfirm', { name: u.name }))) return;
    await dbDelete('items', u.id);
    if (fxStore.state.peek().presetId === u.id) fxStore.update({ presetId: '' });
    await loadPresets();
  };

  const running = live.status === 'on';
  const activeUser = userPresets.find((u) => u.id === state.presetId) ?? null;
  const pct = (v: number) => (settings.lang.value === 'tr' ? `%${Math.round(v)}` : `${Math.round(v)}%`);
  const delayMs = Math.round(delaySeconds(preset.delay, bpm) * 1000);

  return (
    <div class="stack fx">
      {(!running || live.muted) && !live.tripped && (
        <Notice kind="info" testid="fx-headphones">
          <strong>{t('fx.headphonesTitle')}</strong> {t('fx.headphones')}
        </Notice>
      )}
      {live.tripped && (
        <Notice kind="error" testid="fx-tripped">
          {t(live.tripped === 'clip' ? 'fx.trippedClip' : 'fx.trippedHowl')}
        </Notice>
      )}
      {status === 'denied' && <Notice kind="error" testid="input-error">{t('input.denied')}</Notice>}
      {status === 'unavailable' && <Notice kind="error" testid="input-error">{t('input.unavailable')}</Notice>}
      {status === 'error' && <Notice kind="error" testid="input-error">{t('input.error')}</Notice>}

      <Card class="fx-live" testid="fx-live">
        <div class="row">
          {live.status === 'off' ? (
            <button
              type="button"
              class="btn primary big grow"
              onClick={() => void startFx({ preset, input, volume, bpm })}
              data-testid="fx-start"
            >
              <Icon name="play" /> {t('fx.start')}
            </button>
          ) : (
            <button type="button" class="btn big grow" onClick={() => stopFx()} disabled={live.status === 'starting'} data-testid="fx-stop">
              <Icon name="stop" /> {t('common.stop')}
            </button>
          )}
          <button
            type="button"
            class={`btn big grow ${running && live.muted ? 'primary' : ''}`}
            disabled={!running}
            onClick={() => setFxMuted(!live.muted)}
            aria-pressed={!live.muted}
            data-testid="fx-mute"
            data-muted={live.muted ? 'true' : 'false'}
          >
            <Icon name="speaker" /> {t(live.muted ? 'fx.unmute' : 'fx.mute')}
          </button>
        </div>
        <Knob
          label={t('fx.volume')}
          value={volume}
          min={0}
          max={100}
          format={pct}
          onChange={(v) => fxStore.update({ volume: v })}
          testid="fx-volume"
        />
        <div class="fx-meters">
          <span class="field-label">{t('fx.inLevel')}</span>
          <LevelMeter />
          <span class="field-label">{t('fx.outLevel')}</span>
          <OutputMeter />
        </div>
        <LatencyBox running={running} driveOn={preset.drive.on} />
      </Card>

      <Card title={t('fx.presets')} testid="fx-presets">
        <div class="chips" role="group" aria-label={t('fx.presets')}>
          {BUILTIN_PRESETS.map((b) => (
            <button
              type="button"
              class={`chip ${state.presetId === b.id ? 'active' : ''}`}
              aria-pressed={state.presetId === b.id}
              onClick={() => choose(b.id, b.preset)}
              data-testid={`fx-preset-${b.id}`}
            >
              {t(`fx.preset.${b.id}` as Key)}
            </button>
          ))}
          {userPresets.map((u) => (
            <button
              type="button"
              class={`chip user ${state.presetId === u.id ? 'active' : ''}`}
              aria-pressed={state.presetId === u.id}
              onClick={() => choose(u.id, sanitizePreset(u.preset))}
              data-testid="fx-user-preset"
            >
              {u.name}
            </button>
          ))}
        </div>
        {state.presetId === '' && <p class="help" data-testid="fx-custom">{t('fx.custom')}</p>}
        {naming === null ? (
          <div class="row">
            <button type="button" class="btn grow" onClick={() => setNaming(activeUser?.name ?? '')} data-testid="fx-save">
              <Icon name="plus" /> {t('fx.savePreset')}
            </button>
            {activeUser && (
              <button
                type="button"
                class="btn danger"
                aria-label={t('fx.deletePreset', { name: activeUser.name })}
                onClick={() => void removePreset(activeUser)}
                data-testid="fx-delete"
              >
                <Icon name="trash" />
              </button>
            )}
          </div>
        ) : (
          <div class="row">
            <input
              class="input grow2"
              value={naming}
              maxLength={40}
              placeholder={t('fx.presetName')}
              aria-label={t('fx.presetName')}
              onInput={(e) => setNaming((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void savePreset();
                if (e.key === 'Escape') setNaming(null);
              }}
              data-testid="fx-name"
            />
            <button type="button" class="btn primary grow" onClick={() => void savePreset()} disabled={!presetName(naming)} data-testid="fx-name-save">
              {t('common.save')}
            </button>
            <button type="button" class="btn grow" onClick={() => setNaming(null)}>
              {t('common.cancel')}
            </button>
          </div>
        )}
      </Card>

      <div class="fx-grid">
        <Card title={t('fx.input')} testid="fx-input">
          <Knob
            label={t('fx.gain')}
            value={input.gainDb}
            min={GAIN_RANGE.min}
            max={GAIN_RANGE.max}
            format={(v) => `${v > 0 ? '+' : ''}${v} dB`}
            onChange={(v) => setInput({ gainDb: v })}
            testid="fx-gain"
          />
          <Toggle label={t('fx.gate')} checked={input.gateOn} onChange={(v) => setInput({ gateOn: v })} testid="fx-gate" />
          {input.gateOn && (
            <Knob
              label={t('fx.gateThreshold')}
              value={input.gateDb}
              min={GATE_RANGE.min}
              max={GATE_RANGE.max}
              format={(v) => `${v} dB`}
              onChange={(v) => setInput({ gateDb: v })}
              testid="fx-gate-db"
            />
          )}
          <p class="help">{t('fx.inputHelp')}</p>
        </Card>

        <Card class={`fx-unit ${preset.drive.on ? 'on' : ''}`} testid="fx-drive">
          <Toggle label={t('fx.drive')} checked={preset.drive.on} onChange={(v) => patch('drive', { on: v })} testid="fx-drive-on" />
          {preset.drive.on && (
            <>
              <Knob label={t('fx.driveAmount')} value={preset.drive.drive} min={0} max={100} format={pct} onChange={(v) => patch('drive', { drive: v })} testid="fx-drive-drive" />
              <Knob label={t('fx.tone')} value={preset.drive.tone} min={0} max={100} format={pct} onChange={(v) => patch('drive', { tone: v })} testid="fx-drive-tone" />
              <Knob label={t('fx.level')} value={preset.drive.level} min={0} max={100} format={pct} onChange={(v) => patch('drive', { level: v })} testid="fx-drive-level" />
            </>
          )}
        </Card>

        <Card class={`fx-unit ${preset.delay.on ? 'on' : ''}`} testid="fx-delay">
          <Toggle label={t('fx.delay')} checked={preset.delay.on} onChange={(v) => patch('delay', { on: v })} testid="fx-delay-on" />
          {preset.delay.on && (
            <>
              <Toggle
                label={t('fx.sync', { bpm })}
                checked={preset.delay.sync}
                onChange={(v) => patch('delay', { sync: v })}
                testid="fx-delay-sync"
              />
              {preset.delay.sync ? (
                <div class="field">
                  <div class="fx-knob-head">
                    <span class="field-label">{t('fx.division')}</span>
                    <output class="fx-knob-value" data-testid="fx-delay-time-value">{delayMs} ms</output>
                  </div>
                  <Segmented<DelayDivision>
                    label={t('fx.division')}
                    options={DELAY_DIVISIONS.map((d) => ({ value: d, label: d }))}
                    value={preset.delay.division}
                    onChange={(v) => patch('delay', { division: v })}
                    testid="fx-delay-division"
                  />
                </div>
              ) : (
                <Knob label={t('fx.time')} value={preset.delay.timeMs} min={20} max={1500} step={10} format={(v) => `${v} ms`} onChange={(v) => patch('delay', { timeMs: v })} testid="fx-delay-time" />
              )}
              <Knob label={t('fx.feedback')} value={preset.delay.feedback} min={0} max={90} format={pct} onChange={(v) => patch('delay', { feedback: v })} testid="fx-delay-feedback" />
              <Knob label={t('fx.mix')} value={preset.delay.mix} min={0} max={100} format={pct} onChange={(v) => patch('delay', { mix: v })} testid="fx-delay-mix" />
            </>
          )}
        </Card>

        <Card class={`fx-unit ${preset.reverb.on ? 'on' : ''}`} testid="fx-reverb">
          <Toggle label={t('fx.reverb')} checked={preset.reverb.on} onChange={(v) => patch('reverb', { on: v })} testid="fx-reverb-on" />
          {preset.reverb.on && (
            <>
              <Knob label={t('fx.size')} value={preset.reverb.size} min={0} max={100} format={pct} onChange={(v) => patch('reverb', { size: v })} testid="fx-reverb-size" />
              <Knob
                label={t('fx.decay')}
                value={preset.reverb.decay}
                min={0.3}
                max={6}
                step={0.1}
                format={(v) => `${fmtNumber(v, 1)} s`}
                onChange={(v) => patch('reverb', { decay: v })}
                testid="fx-reverb-decay"
              />
              <Knob label={t('fx.mix')} value={preset.reverb.mix} min={0} max={100} format={pct} onChange={(v) => patch('reverb', { mix: v })} testid="fx-reverb-mix" />
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
