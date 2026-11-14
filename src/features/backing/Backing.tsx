import { useEffect, useRef, useState } from 'preact/hooks';
import { clampBpm, MAX_BPM, MIN_BPM } from '../../audio/clock';
import { dbAll, dbDelete, dbPut, newId } from '../../db/db';
import { persistent } from '../../db/persist';
import { t } from '../../i18n';
import {
  chordAtBeat,
  homeKey,
  namesForKey,
  nextChord,
  parseProgressionText,
  resolveTemplate,
  TEMPLATES,
  transposeBars,
  type Bar,
  type ProgMode,
} from '../../music/progressions';
import { scaleNoteNames, scaleRootName, SCALES, type ScaleId } from '../../music/scales';
import { COMMON_NAMES, mod12 } from '../../music/theory';
import { Card, Notice, Segmented, Slider, Stepper, Toggle } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { backing, type BackingConfig } from './player';
import { BEATS_PER_BAR, STYLE_IDS, STYLES, type StyleId } from './styles';

interface BackingState {
  progressionId: string;
  key: number;
  bpm: number;
  style: StyleId;
  loop: boolean;
  countIn: boolean;
  drums: number;
  bass: number;
  chords: number;
}

export const backingStore = persistent<BackingState>('backing', {
  progressionId: 'blues12',
  key: 9,
  bpm: 100,
  style: 'blues',
  loop: true,
  countIn: true,
  drums: 90,
  bass: 85,
  chords: 75,
});

export interface CustomProgression {
  id: string;
  name: string;
  text: string;
}

function isCustomProgression(v: unknown): v is CustomProgression {
  if (!v || typeof v !== 'object') return false;
  const o = v as Partial<CustomProgression>;
  return typeof o.id === 'string' && typeof o.name === 'string' && typeof o.text === 'string';
}

export interface ResolvedProgression {
  bars: Bar[];
  mode: ProgMode;
  scales: ScaleId[];
  custom: CustomProgression | null;
}

/** Seçili diziyi ve tonu çalınacak akorlara çevirir. */
export function resolveProgression(id: string, key: number, customs: CustomProgression[]): ResolvedProgression {
  const custom = customs.find((c) => `custom:${c.id}` === id);
  if (custom) {
    const parsed = parseProgressionText(custom.text);
    const home = homeKey(parsed.bars);
    return {
      bars: transposeBars(parsed.bars, mod12(key - home.root), namesForKey(key, home.mode)),
      mode: home.mode,
      scales: home.mode === 'minor' ? ['minorPent', 'minor'] : ['majorPent', 'major'],
      custom,
    };
  }
  const template = TEMPLATES.find((p) => p.id === id) ?? TEMPLATES[0];
  return { bars: resolveTemplate(template, key), mode: template.mode, scales: template.scales, custom: null };
}

function BarsGrid({ bars, current }: { bars: Bar[]; current: number }) {
  return (
    <div class="bars" data-testid="bars" data-current={current}>
      {bars.map((bar, i) => (
        <div class={`bar-cell ${i === current ? 'now' : ''}`}>
          <span class="bar-num">{i + 1}</span>
          <span class="bar-chords">{bar.map((c) => c.symbol).join('  ')}</span>
        </div>
      ))}
    </div>
  );
}

function ProgressionEditor(props: {
  draft: CustomProgression;
  existing: boolean;
  onChange: (d: CustomProgression) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const parsed = parseProgressionText(props.draft.text);
  return (
    <div class="editor" data-testid="prog-editor">
      <label class="field">
        <span class="field-label">{t('backing.name')}</span>
        <input
          class="input"
          type="text"
          maxLength={40}
          value={props.draft.name}
          onInput={(e) => props.onChange({ ...props.draft, name: (e.target as HTMLInputElement).value })}
          data-testid="prog-name"
        />
      </label>
      <label class="field">
        <span class="field-label">{t('backing.text')}</span>
        <textarea
          class="input textarea"
          rows={3}
          spellcheck={false}
          autocapitalize="off"
          value={props.draft.text}
          onInput={(e) => props.onChange({ ...props.draft, text: (e.target as HTMLTextAreaElement).value })}
          data-testid="prog-text"
        />
      </label>
      <p class="help">{t('backing.textHelp')}</p>
      {parsed.errors.length > 0 && (
        <Notice kind="error" testid="prog-errors">
          {t('backing.unknown', { list: parsed.errors.join(', ') })}
        </Notice>
      )}
      {parsed.bars.length > 0 ? <BarsGrid bars={parsed.bars} current={-1} /> : <p class="help">{t('backing.empty')}</p>}
      <div class="row">
        <button
          type="button"
          class="btn primary grow"
          onClick={props.onSave}
          disabled={parsed.bars.length === 0 || parsed.errors.length > 0}
          data-testid="prog-save"
        >
          {t('common.save')}
        </button>
        <button type="button" class="btn grow" onClick={props.onCancel}>
          {t('common.cancel')}
        </button>
        {props.existing && (
          <button type="button" class="btn danger" aria-label={t('common.delete')} onClick={props.onDelete} data-testid="prog-delete">
            <Icon name="trash" />
          </button>
        )}
      </div>
    </div>
  );
}

export function BackingScreen() {
  const s = backingStore.state.value;
  const running = backing.running.value;
  const pos = backing.position.value;
  const [customs, setCustoms] = useState<CustomProgression[]>([]);
  const [draft, setDraft] = useState<CustomProgression | null>(null);

  const resolved = resolveProgression(s.progressionId, s.key, customs);
  const { bars } = resolved;
  const config: BackingConfig = {
    bars,
    bpm: s.bpm,
    style: s.style,
    loop: s.loop,
    countIn: s.countIn,
    levels: { drums: s.drums / 100, bass: s.bass / 100, chords: s.chords / 100 },
  };
  const configRef = useRef(config);
  configRef.current = config;
  const configKey = JSON.stringify([bars.map((b) => b.map((c) => c.symbol)), s]);

  const loadCustoms = () =>
    dbAll('items', 'progression').then((rows) => setCustoms((rows as unknown[]).filter(isCustomProgression)));

  useEffect(() => {
    void loadCustoms();
    return () => backing.stop();
  }, []);

  useEffect(() => {
    if (backing.running.peek()) backing.update(configRef.current);
  }, [configKey]);

  const playing = running && pos && !pos.countIn ? pos : null;
  const current = playing ? chordAtBeat(bars[playing.bar], playing.beat, BEATS_PER_BAR) : bars[0]?.[0];
  const upcoming = playing
    ? nextChord(bars, playing.bar, playing.beat, s.loop, BEATS_PER_BAR)
    : running && pos?.countIn
      ? bars[0]?.[0]
      : nextChord(bars, 0, 0, s.loop, BEATS_PER_BAR);

  const selectProgression = (id: string) => {
    const patch: Partial<BackingState> = { progressionId: id };
    const custom = customs.find((c) => `custom:${c.id}` === id);
    if (custom) patch.key = homeKey(parseProgressionText(custom.text).bars).root;
    else if (id.toLowerCase().includes('blues')) patch.style = 'blues';
    else if (id === 'funkVamp') patch.style = 'funk';
    backingStore.update(patch);
  };

  const saveDraft = async () => {
    if (!draft) return;
    const record = { ...draft, name: draft.name.trim() || t('backing.defaultName') };
    await dbPut('items', { ...record, type: 'progression', date: Date.now() });
    await loadCustoms();
    backingStore.update({
      progressionId: `custom:${record.id}`,
      key: homeKey(parseProgressionText(record.text).bars).root,
    });
    setDraft(null);
  };

  const deleteDraft = async () => {
    if (!draft) return;
    await dbDelete('items', draft.id);
    await loadCustoms();
    if (s.progressionId === `custom:${draft.id}`) backingStore.update({ progressionId: TEMPLATES[0].id });
    setDraft(null);
  };

  const toggle = () => {
    if (running) backing.stop();
    else void backing.start(config);
  };

  return (
    <div class="backing">
      <Card class="backing-main" testid="backing">
        <div class="now-next">
          <div class="now">
            <span class="now-label">{running && pos?.countIn ? t('backing.counting') : t('backing.now')}</span>
            <span class="now-chord" data-testid="now-chord">
              {running && pos?.countIn ? BEATS_PER_BAR - pos.beat : (current?.symbol ?? '–')}
            </span>
          </div>
          <div class="next">
            <span class="now-label">{t('backing.next')}</span>
            <span class="next-chord" data-testid="next-chord">
              {upcoming?.symbol ?? '–'}
            </span>
          </div>
        </div>
        <div class="beat-row" data-testid="backing-beats">
          {Array.from({ length: BEATS_PER_BAR }, (_, i) => (
            <span class={`beat-pip ${running && pos?.beat === i ? 'now' : ''} ${i === 0 ? 'first' : ''}`} />
          ))}
          <span class="bar-count" data-testid="bar-count">
            {t('backing.bar', { n: playing ? playing.bar + 1 : 1, total: bars.length })}
          </span>
        </div>
        <BarsGrid bars={bars} current={playing ? playing.bar : -1} />
        <button
          type="button"
          class={`btn big block ${running ? '' : 'primary'}`}
          onClick={toggle}
          aria-pressed={running}
          data-testid="backing-toggle"
        >
          <Icon name={running ? 'stop' : 'play'} /> {running ? t('backing.stop') : t('backing.play')}
        </button>
      </Card>

      <div class="stack">
        <Card title={t('backing.progression')} testid="backing-settings">
          {draft ? (
            <ProgressionEditor
              draft={draft}
              existing={customs.some((c) => c.id === draft.id)}
              onChange={setDraft}
              onSave={saveDraft}
              onCancel={() => setDraft(null)}
              onDelete={deleteDraft}
            />
          ) : (
            <>
              <select
                class="select"
                aria-label={t('backing.progression')}
                value={resolved.custom ? `custom:${resolved.custom.id}` : s.progressionId}
                onChange={(e) => selectProgression((e.target as HTMLSelectElement).value)}
                data-testid="progression"
              >
                <optgroup label={t('backing.templates')}>
                  {TEMPLATES.map((p) => (
                    <option value={p.id}>{t(p.name)}</option>
                  ))}
                </optgroup>
                {customs.length > 0 && (
                  <optgroup label={t('backing.custom')}>
                    {customs.map((c) => (
                      <option value={`custom:${c.id}`}>{c.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div class="row">
                <button
                  type="button"
                  class="btn grow"
                  onClick={() => setDraft({ id: newId(), name: t('backing.defaultName'), text: 'Am | F | C | G' })}
                  data-testid="prog-new"
                >
                  <Icon name="plus" /> {t('backing.new')}
                </button>
                {resolved.custom && (
                  <button type="button" class="btn grow" onClick={() => setDraft(resolved.custom)} data-testid="prog-edit">
                    <Icon name="edit" /> {t('backing.edit')}
                  </button>
                )}
              </div>
            </>
          )}

          <div class="field">
            <span class="field-label">{t('backing.key')}</span>
            <div class="root-grid" role="radiogroup" aria-label={t('backing.key')} data-testid="backing-key">
              {COMMON_NAMES.map((name, i) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={i === s.key}
                  class={`chip ${i === s.key ? 'active' : ''}`}
                  onClick={() => backingStore.update({ key: i })}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div class="field">
            <span class="field-label">{t('backing.style')}</span>
            <Segmented
              label={t('backing.style')}
              options={STYLE_IDS.map((id) => ({ value: id, label: t(STYLES[id].name) }))}
              value={s.style}
              onChange={(style) => backingStore.update({ style })}
              testid="backing-style"
            />
          </div>

          <div class="field">
            <span class="field-label">{t('backing.tempo')}</span>
            <Stepper
              label={t('backing.tempo')}
              value={s.bpm}
              min={MIN_BPM}
              max={MAX_BPM}
              step={5}
              onChange={(bpm) => backingStore.update({ bpm: clampBpm(bpm) })}
              format={(v) => `${v} BPM`}
              testid="backing-bpm"
            />
            <Slider
              label={t('backing.tempo')}
              value={s.bpm}
              min={MIN_BPM}
              max={MAX_BPM}
              onChange={(bpm) => backingStore.update({ bpm: clampBpm(bpm) })}
              testid="backing-bpm-slider"
            />
          </div>

          <Toggle label={t('backing.loop')} checked={s.loop} onChange={(loop) => backingStore.update({ loop })} testid="backing-loop" />
          <Toggle
            label={t('backing.countInToggle')}
            checked={s.countIn}
            onChange={(countIn) => backingStore.update({ countIn })}
            testid="backing-countin"
          />
        </Card>

        <Card title={t('backing.scales')} testid="scales">
          <p class="help">{t('backing.scalesHelp')}</p>
          {resolved.scales.map((id) => (
            <div class="scale-row" data-testid={`scale-${id}`}>
              <strong>
                {scaleRootName(s.key, id)} {t(SCALES[id].name)}
              </strong>
              <span class="scale-notes">{scaleNoteNames(s.key, id).join('  ')}</span>
            </div>
          ))}
        </Card>

        <Card title={t('backing.mixer')} testid="mixer">
          {(['drums', 'bass', 'chords'] as const).map((part) => (
            <div class="field">
              <span class="field-label">
                {t(`backing.${part}`)} · {s[part]}%
              </span>
              <Slider
                label={t(`backing.${part}`)}
                value={s[part]}
                min={0}
                max={100}
                step={5}
                onChange={(v) => backingStore.update({ [part]: v })}
                testid={`level-${part}`}
              />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
