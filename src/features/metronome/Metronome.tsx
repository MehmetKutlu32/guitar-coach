import { useEffect, useRef, useState } from 'preact/hooks';
import { clampBpm, MAX_BPM, MIN_BPM, TapTempo, tempoName } from '../../audio/clock';
import { metronome, type MetronomeConfig } from '../../audio/metronome';
import { strumChord } from '../../audio/synth/guitar';
import { dbAll, dbDelete, dbPut, newId } from '../../db/db';
import { persistent } from '../../db/persist';
import { t, type Key } from '../../i18n';
import { settings } from '../../settings';
import { Card, Segmented, Slider, Stepper, Toggle } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import {
  emptyPattern,
  getMeter,
  isValidPattern,
  METERS,
  nextStroke,
  PRESET_PATTERNS,
  resizePattern,
  slotForStep,
  slotLabel,
  type Stroke,
  type StrumPattern,
} from './patterns';

export interface MetroState {
  bpm: number;
  meter: string;
  accents: number[];
  subdivision: number;
  trainerOn: boolean;
  trainerEvery: number;
  trainerStep: number;
  trainerMax: number;
  patternId: string;
  patternSound: boolean;
}

export const metroStore = persistent<MetroState>('metronome', {
  bpm: 90,
  meter: '4/4',
  accents: [2, 1, 1, 1],
  subdivision: 1,
  trainerOn: false,
  trainerEvery: 4,
  trainerStep: 5,
  trainerMax: 140,
  patternId: '',
  patternSound: true,
});

/** Kalıp seslendirilirken çalınan akor: açık Mi minör. */
const STRUM_CHORD = [40, 47, 52, 55, 59, 64];

export function StrokeGlyph({ stroke, size = 26 }: { stroke: Stroke; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2.6,
    'stroke-linecap': 'round' as const,
    'stroke-linejoin': 'round' as const,
    'aria-hidden': true,
  };
  if (stroke === 'D')
    return (
      <svg {...common}>
        <path d="M12 3.5v16" />
        <path d="M5.5 13.5 12 20l6.5-6.5" />
      </svg>
    );
  if (stroke === 'U')
    return (
      <svg {...common}>
        <path d="M12 20.5v-16" />
        <path d="M5.5 10.5 12 4l6.5 6.5" />
      </svg>
    );
  if (stroke === 'X')
    return (
      <svg {...common}>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M12 12h.01" />
    </svg>
  );
}

function PatternView({ pattern, current }: { pattern: StrumPattern; current: number }) {
  return (
    <div
      class="pattern"
      style={{ gridTemplateColumns: `repeat(${pattern.slots.length}, minmax(0, 1fr))` }}
      data-testid="pattern-view"
      data-current={current}
    >
      {pattern.slots.map((stroke, i) => (
        <div
          class={`pattern-cell s-${stroke === '-' ? 'rest' : stroke} ${i === current ? 'now' : ''} ${
            i % pattern.division === 0 ? 'on-beat' : ''
          }`}
        >
          <StrokeGlyph stroke={stroke} />
          <span class="pattern-count">{slotLabel(i, pattern.division)}</span>
        </div>
      ))}
    </div>
  );
}

function PatternEditor(props: {
  draft: StrumPattern;
  unit: number;
  onChange: (p: StrumPattern) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const { draft, unit } = props;
  const divisions = unit === 8 ? [1, 2] : [2, 4];
  const rows: number[] = Array.from({ length: draft.beats }, (_, b) => b);
  return (
    <div class="editor" data-testid="pattern-editor">
      <label class="field">
        <span class="field-label">{t('metro.patternName')}</span>
        <input
          class="input"
          type="text"
          maxLength={40}
          value={draft.name}
          onInput={(e) => props.onChange({ ...draft, name: (e.target as HTMLInputElement).value })}
          data-testid="pattern-name"
        />
      </label>
      <div class="field">
        <span class="field-label">{t('metro.patternDivision')}</span>
        <Segmented
          label={t('metro.patternDivision')}
          options={divisions.map((d) => ({ value: d, label: `1/${unit * d}` }))}
          value={draft.division}
          onChange={(d) =>
            props.onChange({ ...draft, division: d, slots: resizePattern(draft.slots, draft.beats, draft.division, d) })
          }
          testid="pattern-division"
        />
      </div>
      <p class="help">{t('metro.patternEditHint')}</p>
      <div class="editor-grid">
        {rows.map((beat) => (
          <div class="editor-row">
            {Array.from({ length: draft.division }, (_, s) => {
              const i = beat * draft.division + s;
              const stroke = draft.slots[i];
              return (
                <button
                  type="button"
                  class={`editor-cell s-${stroke === '-' ? 'rest' : stroke}`}
                  aria-label={t('metro.slot', {
                    label: slotLabel(i, draft.division),
                    stroke: t(`stroke.${stroke}` as Key),
                  })}
                  onClick={() => {
                    const slots = [...draft.slots];
                    slots[i] = nextStroke(stroke);
                    props.onChange({ ...draft, slots });
                  }}
                  data-testid={`slot-${i}`}
                  data-stroke={stroke}
                >
                  <StrokeGlyph stroke={stroke} />
                  <span class="pattern-count">{slotLabel(i, draft.division)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div class="row">
        <button type="button" class="btn primary grow" onClick={props.onSave} data-testid="pattern-save">
          {t('common.save')}
        </button>
        <button type="button" class="btn grow" onClick={props.onCancel}>
          {t('common.cancel')}
        </button>
        {props.onDelete && (
          <button type="button" class="btn danger" aria-label={t('common.delete')} onClick={props.onDelete} data-testid="pattern-delete">
            <Icon name="trash" />
          </button>
        )}
      </div>
    </div>
  );
}

export function MetronomeScreen() {
  const s = metroStore.state.value;
  const meter = getMeter(s.meter);
  const unit = meter.id.endsWith('/8') ? 8 : 4;
  const running = metronome.running.value;
  const pos = metronome.position.value;
  const [custom, setCustom] = useState<StrumPattern[]>([]);
  const [draft, setDraft] = useState<StrumPattern | null>(null);
  const tap = useRef(new TapTempo());

  const presets = PRESET_PATTERNS.filter((p) => p.beats === meter.beats);
  const mine = custom.filter((p) => p.beats === meter.beats);
  const pattern = [...presets, ...mine].find((p) => p.id === s.patternId) ?? null;

  const config: MetronomeConfig = {
    bpm: s.bpm,
    beatsPerBar: meter.beats,
    accents: s.accents,
    subdivision: s.subdivision,
    gridPerBeat: pattern?.division ?? 1,
    trainer: s.trainerOn ? { everyBars: s.trainerEvery, increment: s.trainerStep, maxBpm: s.trainerMax } : null,
  };
  const configKey = JSON.stringify(config);
  const configRef = useRef(config);
  configRef.current = config;

  const loadCustom = () =>
    dbAll('items', 'strum').then((rows) =>
      setCustom(
        (rows as unknown[])
          .filter(isValidPattern)
          .map((r) => ({ id: r.id, name: r.name, beats: r.beats, division: r.division, slots: r.slots, custom: true })),
      ),
    );

  useEffect(() => {
    void loadCustom();
    return () => {
      metronome.onStep = null;
      metronome.stop();
    };
  }, []);

  // Çalışırken yapılan her ayar değişikliği motora anında yansır.
  useEffect(() => {
    if (metronome.running.peek()) metronome.update(configRef.current);
  }, [configKey]);

  // Vuruş kalıbını metronomla aynı ana planlanmış gitar vuruşlarıyla seslendir.
  useEffect(() => {
    if (!pattern || !s.patternSound) {
      metronome.onStep = null;
      return;
    }
    metronome.onStep = (ev, stepsPerBeat) => {
      const slot = slotForStep(ev.beat, ev.sub, stepsPerBeat, pattern.division);
      const stroke = slot >= 0 ? pattern.slots[slot] : '-';
      if (stroke && stroke !== '-') {
        strumChord(STRUM_CHORD, stroke, { when: ev.time, gain: 0.32, a4: settings.a4.peek(), duration: 1.4 });
      }
    };
  }, [pattern, s.patternSound]);

  const setBpm = (bpm: number) => metroStore.update({ bpm: clampBpm(bpm) });
  const toggle = () => {
    if (running) metronome.stop();
    else void metronome.start(config);
  };
  const onTap = () => {
    const bpm = tap.current.tap(performance.now());
    if (bpm !== null) setBpm(bpm);
  };
  const cycleAccent = (i: number) => {
    const accents = [...s.accents];
    accents[i] = accents[i] === 1 ? 2 : accents[i] === 2 ? 0 : 1;
    metroStore.update({ accents });
  };

  const shownBpm = running && s.trainerOn && pos ? pos.bpm : s.bpm;
  const currentSlot =
    running && pos && pattern
      ? slotForStep(pos.beat, pos.sub, lcmOf(s.subdivision, pattern.division), pattern.division)
      : -1;

  const startDraft = (base?: StrumPattern) =>
    setDraft(
      base
        ? { ...base }
        : {
            id: newId(),
            name: t('metro.patternDefaultName'),
            beats: meter.beats,
            division: unit === 8 ? 1 : 2,
            slots: emptyPattern(meter.beats, unit === 8 ? 1 : 2),
            custom: true,
          },
    );

  const saveDraft = async () => {
    if (!draft) return;
    const name = draft.name.trim() || t('metro.patternDefaultName');
    await dbPut('items', {
      id: draft.id,
      type: 'strum',
      date: Date.now(),
      name,
      beats: draft.beats,
      division: draft.division,
      slots: draft.slots,
    });
    await loadCustom();
    metroStore.update({ patternId: draft.id });
    setDraft(null);
  };

  const deleteDraft = async () => {
    if (!draft) return;
    await dbDelete('items', draft.id);
    await loadCustom();
    if (s.patternId === draft.id) metroStore.update({ patternId: '' });
    setDraft(null);
  };

  return (
    <div class="metro">
      <Card class="metro-main" testid="metronome">
        <div class="beats" role="group" aria-label={t('metro.beats')} data-testid="beats">
          {s.accents.map((level, i) => (
            <button
              type="button"
              class={`beat-dot l${level} ${running && pos?.beat === i ? 'now' : ''}`}
              aria-label={t('metro.beat', { n: i + 1, level: t(`metro.level${level}` as Key) })}
              data-level={level}
              data-testid={`beat-${i}`}
              onClick={() => cycleAccent(i)}
            >
              {i + 1}
            </button>
          ))}
        </div>
        <p class="help center">{t('metro.beatsHint')}</p>

        <div class="bpm" aria-live="off">
          <span class="bpm-value" data-testid="bpm">
            {shownBpm}
          </span>
          <span class="bpm-unit">
            BPM · {tempoName(shownBpm)}
          </span>
        </div>
        <div class="bpm-buttons">
          {[-5, -1, 1, 5].map((d) => (
            <button
              type="button"
              class="btn"
              aria-label={`${d > 0 ? '+' : '−'}${Math.abs(d)} BPM`}
              onClick={() => setBpm(s.bpm + d)}
              data-testid={`bpm${d > 0 ? 'plus' : 'minus'}${Math.abs(d)}`}
            >
              {d > 0 ? '+' : '−'}
              {Math.abs(d)}
            </button>
          ))}
        </div>
        <Slider label={t('metro.bpm')} value={s.bpm} min={MIN_BPM} max={MAX_BPM} onChange={setBpm} testid="bpm-slider" />

        <div class="row">
          <button
            type="button"
            class={`btn big grow2 ${running ? '' : 'primary'}`}
            onClick={toggle}
            data-testid="metro-toggle"
            aria-pressed={running}
          >
            <Icon name={running ? 'stop' : 'play'} /> {running ? t('metro.stop') : t('metro.start')}
          </button>
          <button type="button" class="btn big grow" onPointerDown={onTap} data-testid="tap">
            {t('metro.tap')}
          </button>
        </div>
      </Card>

      <div class="stack">
        <Card title={t('metro.meter')}>
          <Segmented
            label={t('metro.meter')}
            options={METERS.map((m) => ({ value: m.id, label: m.id }))}
            value={meter.id}
            onChange={(id) => metroStore.update({ meter: id, accents: [...getMeter(id).accents] })}
            testid="meter"
          />
          <div class="field">
            <span class="field-label">{t('metro.subdivision')}</span>
            <Segmented
              label={t('metro.subdivision')}
              options={[1, 2, 3, 4].map((n) => ({ value: n, label: t(`metro.sub${n}` as Key) }))}
              value={s.subdivision}
              onChange={(n) => metroStore.update({ subdivision: n })}
              testid="subdivision"
            />
          </div>
        </Card>

        <Card title={t('metro.pattern')} testid="pattern-card">
          {draft ? (
            <PatternEditor
              draft={draft}
              unit={unit}
              onChange={setDraft}
              onSave={saveDraft}
              onCancel={() => setDraft(null)}
              onDelete={custom.some((p) => p.id === draft.id) ? deleteDraft : undefined}
            />
          ) : (
            <>
              <select
                class="select"
                aria-label={t('metro.pattern')}
                value={pattern?.id ?? ''}
                onChange={(e) => metroStore.update({ patternId: (e.target as HTMLSelectElement).value })}
                data-testid="pattern-select"
              >
                <option value="">{t('metro.patternNone')}</option>
                {presets.length > 0 && (
                  <optgroup label={t('metro.patternPresets')}>
                    {presets.map((p) => (
                      <option value={p.id}>{p.nameKey ? t(p.nameKey) : p.name}</option>
                    ))}
                  </optgroup>
                )}
                {mine.length > 0 && (
                  <optgroup label={t('metro.patternCustom')}>
                    {mine.map((p) => (
                      <option value={p.id}>{p.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {pattern && (
                <>
                  <PatternView pattern={pattern} current={currentSlot} />
                  <p class="help">{t('metro.patternLegend')}</p>
                  <Toggle
                    label={t('metro.patternSound')}
                    checked={s.patternSound}
                    onChange={(v) => metroStore.update({ patternSound: v })}
                    testid="pattern-sound"
                  />
                </>
              )}
              <div class="row">
                <button type="button" class="btn grow" onClick={() => startDraft()} data-testid="pattern-new">
                  <Icon name="plus" /> {t('metro.patternNew')}
                </button>
                {pattern?.custom && (
                  <button type="button" class="btn grow" onClick={() => startDraft(pattern)} data-testid="pattern-edit">
                    <Icon name="edit" /> {t('metro.patternEdit')}
                  </button>
                )}
              </div>
            </>
          )}
        </Card>

        <Card title={t('metro.trainer')} testid="trainer">
          <Toggle
            label={t('metro.trainerOn')}
            checked={s.trainerOn}
            onChange={(v) => metroStore.update({ trainerOn: v, trainerMax: Math.max(s.trainerMax, s.bpm + s.trainerStep) })}
            testid="trainer-on"
          />
          {s.trainerOn && (
            <>
              <div class="field">
                <span class="field-label">{t('metro.trainerEvery')}</span>
                <Stepper
                  label={t('metro.trainerEvery')}
                  value={s.trainerEvery}
                  min={1}
                  max={32}
                  onChange={(v) => metroStore.update({ trainerEvery: v })}
                  format={(v) => t('metro.trainerEveryValue', { n: v })}
                  testid="trainer-every"
                />
              </div>
              <div class="field">
                <span class="field-label">{t('metro.trainerStep')}</span>
                <Stepper
                  label={t('metro.trainerStep')}
                  value={s.trainerStep}
                  min={1}
                  max={30}
                  onChange={(v) => metroStore.update({ trainerStep: v })}
                  format={(v) => `+${v} BPM`}
                  testid="trainer-step"
                />
              </div>
              <div class="field">
                <span class="field-label">{t('metro.trainerMax')}</span>
                <Stepper
                  label={t('metro.trainerMax')}
                  value={s.trainerMax}
                  min={MIN_BPM}
                  max={MAX_BPM}
                  step={5}
                  onChange={(v) => metroStore.update({ trainerMax: v })}
                  format={(v) => `${v} BPM`}
                  testid="trainer-max"
                />
              </div>
              <p class="help">
                {t('metro.trainerHelp', { n: s.trainerEvery, step: s.trainerStep, max: s.trainerMax })}
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function lcmOf(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];
  return (a / x) * b;
}
