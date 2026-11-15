import { effect } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { audioCtx, masterOut, resumeAudio } from '../../audio/engine';
import { inputStatus } from '../../audio/input';
import { scheduleClick } from '../../audio/metronome';
import { strumChord } from '../../audio/synth/guitar';
import { dbAll, dbPut, newId } from '../../db/db';
import { persistent } from '../../db/persist';
import { t, type Key } from '../../i18n';
import {
  chordsFor,
  chordSymbols,
  primaryShape,
  shapeNotes,
  type ChordCategory,
  type ChordShape,
} from '../../music/chords';
import { isChordPlayed, pickTarget, TransitionCounter, type ChordTarget } from '../../music/recognize';
import { COMMON_NAMES } from '../../music/theory';
import { navigate, route } from '../../router';
import { settings } from '../../settings';
import { LineChart } from '../../ui/charts';
import { ChordDiagram } from '../../ui/ChordDiagram';
import { Card, LevelMeter, Notice, Segmented, Stepper, Toggle } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { chordListening, heardChord, listenForChords } from './listener';
import {
  isNewBest,
  isTransitionResult,
  pairKey,
  perMinute,
  resultsForPair,
  summarizePairs,
  type TransitionResult,
} from './transitions';

interface ChordsState {
  category: ChordCategory;
  root: number;
  a: string;
  b: string;
  seconds: number;
  /** Geçişler mikrofonla otomatik sayılsın mı. */
  auto: boolean;
}

export const chordsStore = persistent<ChordsState>('chords', {
  category: 'open',
  root: 0,
  a: 'Em',
  b: 'G',
  seconds: 60,
  auto: false,
});

const CATEGORIES: ChordCategory[] = ['open', 'barre', 'power'];
const QUICK_PAIRS: [string, string][] = [
  ['Em', 'G'],
  ['Am', 'C'],
  ['C', 'G'],
  ['D', 'A'],
  ['G', 'D'],
  ['Am', 'Em'],
  ['C', 'F'],
  ['E', 'A'],
];
const COUNT_IN = 3;

export async function playShape(shape: ChordShape, arpeggio = false): Promise<void> {
  await resumeAudio();
  strumChord(shapeNotes(shape), 'D', {
    a4: settings.a4.peek(),
    gain: 0.5,
    spread: arpeggio ? 0.24 : 0.022,
    duration: 3,
  });
}

function shapeHint(shape: ChordShape): string {
  if (!shape.rootString) return '';
  const fret = shape.frets[shape.rootString === 6 ? 0 : 1];
  return fret === 0
    ? t('chords.rootOpen', { n: shape.rootString })
    : t('chords.rootString', { n: shape.rootString, fret });
}

const asTarget = (shape: ChordShape): ChordTarget => ({ root: shape.root, quality: shape.quality, symbol: shape.symbol });

function InputErrors() {
  const status = inputStatus.value;
  if (status === 'denied') return <Notice kind="error" testid="input-error">{t('input.denied')}</Notice>;
  if (status === 'unavailable') return <Notice kind="error" testid="input-error">{t('input.unavailable')}</Notice>;
  if (status === 'error') return <Notice kind="error" testid="input-error">{t('input.error')}</Notice>;
  return null;
}

/** Mikrofonu dinler, duyulan akoru gösterir ve seçili akorun doğru basılıp basılmadığını denetler. */
function ChordListener({ target }: { target: ChordShape | null }) {
  const on = chordListening.value;
  const heard = heardChord.value;
  const release = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      release.current?.();
      release.current = null;
    },
    [],
  );

  const toggle = async () => {
    if (release.current) {
      release.current();
      release.current = null;
      return;
    }
    try {
      release.current = await listenForChords();
    } catch {
      /* durum sinyali hatayı gösterir */
    }
  };

  const played = on && target !== null && heard.sounding && isChordPlayed(heard.chroma, heard.bass, asTarget(target));
  return (
    <Card title={on ? undefined : t('listen.title')} class={on ? 'listener-on' : ''} testid="chord-listener">
      {on ? (
        <>
          <div class="heard">
            <span class="now-label">{t('listen.heard')}</span>
            <span class="heard-chord" data-testid="heard-chord">
              {heard.guess?.symbol ?? '–'}
            </span>
          </div>
          {target ? (
            <Notice kind={played ? 'good' : 'info'} testid="listen-check">
              {played
                ? t('listen.match', { name: target.symbol })
                : heard.guess && heard.guess.symbol !== target.symbol
                  ? t('listen.wrong', { name: target.symbol, heard: heard.guess.symbol })
                  : t('listen.expect', { name: target.symbol })}
            </Notice>
          ) : (
            <p class="help center">{t('listen.pick')}</p>
          )}
          <LevelMeter />
        </>
      ) : (
        <p class="help">{t('listen.help')}</p>
      )}
      <InputErrors />
      <button type="button" class={`btn block ${on ? '' : 'primary'}`} onClick={toggle} data-testid="listen-toggle">
        <Icon name={on ? 'stop' : 'mic'} /> {on ? t('listen.stop') : t('listen.start')}
      </button>
    </Card>
  );
}

function Library() {
  const s = chordsStore.state.value;
  const [last, setLast] = useState('');
  const shapes = chordsFor(s.category, s.root);
  const target = shapes.find((sh) => sh.id === last) ?? null;
  const play = (shape: ChordShape, arpeggio: boolean) => {
    setLast(shape.id);
    void playShape(shape, arpeggio);
  };
  return (
    <>
      <Card>
        <Segmented
          label={t('chords.category')}
          options={CATEGORIES.map((c) => ({ value: c, label: t(`chords.cat.${c}` as Key) }))}
          value={s.category}
          onChange={(category) => chordsStore.update({ category })}
          testid="chord-category"
        />
        {s.category !== 'open' && (
          <div class="root-grid" role="radiogroup" aria-label={t('chords.root')} data-testid="chord-root">
            {COMMON_NAMES.map((name, i) => (
              <button
                type="button"
                role="radio"
                aria-checked={i === s.root}
                class={`chip ${i === s.root ? 'active' : ''}`}
                onClick={() => chordsStore.update({ root: i })}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <p class="help">{t('chords.legend')}</p>
      </Card>
      <ChordListener target={target} />
      <div class="chord-grid" data-testid="chord-grid">
        {shapes.map((shape) => (
          <div class={`chord-card ${last === shape.id ? 'played' : ''}`} data-testid={`chord-${shape.id}`}>
            <button
              type="button"
              class="chord-play"
              aria-label={t('chords.play', { name: shape.symbol })}
              onClick={() => play(shape, false)}
            >
              <strong class="chord-name">{shape.symbol}</strong>
              <ChordDiagram shape={shape} />
              {shape.rootString && <span class="chord-hint">{shapeHint(shape)}</span>}
            </button>
            <button type="button" class="btn chord-arp" onClick={() => play(shape, true)}>
              <Icon name="speaker" size={20} /> {t('chords.arpeggio')}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

function ChordSelect(props: { label: string; value: string; onChange: (v: string) => void; testid: string }) {
  return (
    <label class="field grow">
      <span class="field-label">{props.label}</span>
      <select
        class="select"
        value={props.value}
        onChange={(e) => props.onChange((e.target as HTMLSelectElement).value)}
        data-testid={props.testid}
      >
        {CATEGORIES.map((c) => (
          <optgroup label={t(`chords.cat.${c}` as Key)}>
            {chordSymbols(c).map((sym) => (
              <option value={sym}>{sym}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

type Phase = 'idle' | 'countin' | 'running' | 'done';

function Practice() {
  const s = chordsStore.state.value;
  const lang = settings.lang.value;
  const [results, setResults] = useState<TransitionResult[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [display, setDisplay] = useState(0);
  const [count, setCount] = useState(0);
  const [saved, setSaved] = useState<{ rate: number; best: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Otomatik sayım: dinlemeyi ve sinyal aboneliğini kapatan fonksiyon. */
  const listening = useRef<(() => void) | null>(null);
  const [heardIndex, setHeardIndex] = useState(-1);

  const shapeA = primaryShape(s.a) ?? primaryShape('Em')!;
  const shapeB = primaryShape(s.b) ?? primaryShape('G')!;
  const pair = pairKey(shapeA.symbol, shapeB.symbol);
  const history = resultsForPair(results, pair);
  const summaries = summarizePairs(results);
  const current = summaries.find((p) => p.pair === pair);

  const load = () => dbAll('results', 'transition').then((rows) => setResults((rows as unknown[]).filter(isTransitionResult)));
  const clearTimer = () => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  };
  const stopListening = () => {
    listening.current?.();
    listening.current = null;
    setHeardIndex(-1);
  };

  useEffect(() => {
    void load();
    return () => {
      clearTimer();
      listening.current?.();
      listening.current = null;
    };
  }, []);

  /** Mikrofonu açar ve iki akor arasındaki her kararlı geçişte sayacı artırır. */
  const startAutoCount = async (isRunning: () => boolean) => {
    const targets = [asTarget(shapeA), asTarget(shapeB)];
    const counter = new TransitionCounter(3);
    const release = await listenForChords();
    const off = effect(() => {
      const h = heardChord.value;
      if (!isRunning()) return;
      const index = h.sounding && h.chroma.length === 12 ? pickTarget(h.chroma, h.bass, targets) : -1;
      if (counter.push(index)) setCount((c) => c + 1);
      setHeardIndex(counter.current);
    });
    listening.current = () => {
      off();
      release();
    };
  };

  const start = async () => {
    const ctx = await resumeAudio();
    let running = false;
    if (s.auto) {
      try {
        await startAutoCount(() => running);
      } catch {
        return;
      }
    }
    setSaved(null);
    setCount(0);
    setPhase('countin');
    setDisplay(COUNT_IN);
    // Geri sayım tıkları ses saatine göre planlanır; ekrandaki sayaç duvar saatini izler.
    const now = ctx.currentTime + 0.05;
    for (let i = 0; i < COUNT_IN; i++) scheduleClick(ctx, masterOut(), now + i, 'beat');
    scheduleClick(ctx, masterOut(), now + COUNT_IN, 'accent');
    const t0 = performance.now() + 50;
    const startAt = t0 + COUNT_IN * 1000;
    const endAt = startAt + s.seconds * 1000;
    clearTimer();
    timer.current = setInterval(() => {
      const nowMs = performance.now();
      if (nowMs < startAt) {
        setDisplay(Math.ceil((startAt - nowMs) / 1000));
      } else if (nowMs < endAt) {
        if (!running) {
          running = true;
          setPhase('running');
        }
        setDisplay(Math.ceil((endAt - nowMs) / 1000));
      } else {
        clearTimer();
        running = false;
        stopListening();
        const c = audioCtx();
        scheduleClick(c, masterOut(), c.currentTime + 0.02, 'accent');
        scheduleClick(c, masterOut(), c.currentTime + 0.2, 'accent');
        setDisplay(0);
        setPhase('done');
      }
    }, 100);
  };

  const cancel = () => {
    clearTimer();
    stopListening();
    setPhase('idle');
  };

  const save = async () => {
    const record: TransitionResult = {
      id: newId(),
      type: 'transition',
      date: Date.now(),
      a: shapeA.symbol,
      b: shapeB.symbol,
      pair,
      count,
      seconds: s.seconds,
      auto: s.auto,
    };
    const best = isNewBest(history, record);
    await dbPut('results', record);
    await load();
    setSaved({ rate: perMinute(record), best });
    setPhase('idle');
  };

  const fmtDate = (d: number) =>
    new Date(d).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' });

  const active = phase === 'countin' || phase === 'running';

  return (
    <>
      <Card testid="transition">
        <div class="pair">
          {[shapeA, shapeB].map((shape, i) => (
            <button
              type="button"
              class={`pair-chord ${active && heardIndex === i ? 'heard-now' : ''}`}
              data-testid={`pair-chord-${i}`}
              aria-label={t('chords.play', { name: shape.symbol })}
              onClick={() => void playShape(shape)}
            >
              <strong class="chord-name">{shape.symbol}</strong>
              <ChordDiagram shape={shape} />
            </button>
          ))}
        </div>

        {phase === 'idle' && (
          <>
            <div class="row">
              <ChordSelect label={t('tx.first')} value={shapeA.symbol} onChange={(a) => chordsStore.update({ a })} testid="chord-a" />
              <ChordSelect label={t('tx.second')} value={shapeB.symbol} onChange={(b) => chordsStore.update({ b })} testid="chord-b" />
            </div>
            <div class="field">
              <span class="field-label">{t('tx.quick')}</span>
              <div class="chips" data-testid="quick-pairs">
                {QUICK_PAIRS.map(([a, b]) => (
                  <button
                    type="button"
                    class={`chip ${pairKey(a, b) === pair ? 'active' : ''}`}
                    onClick={() => chordsStore.update({ a, b })}
                  >
                    {a} ↔ {b}
                  </button>
                ))}
              </div>
            </div>
            <div class="field">
              <span class="field-label">{t('tx.duration')}</span>
              <Segmented
                label={t('tx.duration')}
                options={[30, 60, 120].map((n) => ({ value: n, label: t('tx.dur', { n }) }))}
                value={s.seconds}
                onChange={(seconds) => chordsStore.update({ seconds })}
                testid="tx-duration"
              />
            </div>
            <Toggle
              label={t('tx.auto')}
              checked={s.auto}
              onChange={(auto) => chordsStore.update({ auto })}
              testid="tx-auto"
            />
            <p class="help">{s.auto ? t('tx.autoHelp') : t('tx.intro')}</p>
            <InputErrors />
            {saved && (
              <Notice kind="good" testid="tx-saved">
                {t('tx.saved', { n: saved.rate })}
                {saved.best ? ` ${t('tx.newBest')}` : ''}
              </Notice>
            )}
            <button
              type="button"
              class="btn primary block big"
              onClick={start}
              disabled={shapeA.symbol === shapeB.symbol}
              data-testid="tx-start"
            >
              <Icon name="play" /> {t('tx.start')}
            </button>
          </>
        )}

        {active && (
          <div class="tx-run" data-testid="tx-run" data-phase={phase}>
            <div class="tx-status">{phase === 'countin' ? t('tx.getReady') : t('tx.remaining')}</div>
            <div class={`tx-clock ${phase === 'countin' ? 'countin' : ''}`} data-testid="tx-clock">
              {display}
            </div>
            <button
              type="button"
              class="btn primary block tx-plus"
              onClick={() => setCount((c) => c + 1)}
              disabled={phase !== 'running'}
              data-testid="tx-plus"
            >
              <span class="tx-plus-big">{count}</span>
              <span>{t('tx.plus')}</span>
            </button>
            {s.auto ? (
              <>
                <p class="help center" data-testid="tx-heard">
                  {heardIndex >= 0 ? t('tx.heard', { name: [shapeA, shapeB][heardIndex].symbol }) : t('tx.heardNone')}
                </p>
                <LevelMeter />
              </>
            ) : (
              <p class="help center">{t('tx.tapHint')}</p>
            )}
            <button type="button" class="btn block" onClick={cancel} data-testid="tx-cancel">
              <Icon name="stop" /> {t('tx.cancel')}
            </button>
          </div>
        )}

        {phase === 'done' && (
          <div class="tx-run" data-testid="tx-done">
            <div class="tx-status good">{t('tx.done')}</div>
            <div class="field">
              <span class="field-label">{t('tx.howMany')}</span>
              <Stepper label={t('tx.howMany')} value={count} min={0} max={300} onChange={setCount} testid="tx-count" />
            </div>
            <div class="row">
              <button type="button" class="btn primary grow2 big" onClick={save} data-testid="tx-save">
                <Icon name="check" /> {t('tx.save')}
              </button>
              <button type="button" class="btn grow big" onClick={cancel} data-testid="tx-discard">
                {t('tx.discard')}
              </button>
            </div>
          </div>
        )}
      </Card>

      <Card title={t('tx.history', { a: shapeA.symbol, b: shapeB.symbol })} testid="tx-history">
        {current ? (
          <>
            <div class="stats">
              <div class="stat">
                <span class="stat-value" data-testid="tx-best">{current.best}</span>
                <span class="stat-label">{t('tx.best')}</span>
              </div>
              <div class="stat">
                <span class="stat-value">{current.last}</span>
                <span class="stat-label">{t('tx.last')}</span>
              </div>
              <div class="stat">
                <span class="stat-value">{current.average}</span>
                <span class="stat-label">{t('tx.avg')}</span>
              </div>
              <div class="stat">
                <span class="stat-value" data-testid="tx-sessions">{current.sessions}</span>
                <span class="stat-label">{t('tx.sessions')}</span>
              </div>
            </div>
            <LineChart
              title={t('tx.chart')}
              points={history.slice(-30).map((r) => ({ value: perMinute(r), label: fmtDate(r.date) }))}
              testid="tx-chart"
            />
            <p class="help center">{t('tx.chart')}</p>
          </>
        ) : (
          <p class="help" data-testid="tx-empty">{t('tx.noHistory')}</p>
        )}
      </Card>

      {summaries.length > 0 && (
        <Card title={t('tx.allPairs')} testid="tx-pairs">
          <div class="list">
            {summaries.map((p) => (
              <button
                type="button"
                class={`list-row ${p.pair === pair ? 'active' : ''}`}
                onClick={() => chordsStore.update({ a: p.a, b: p.b })}
                data-testid={`pair-${p.pair}`}
              >
                <strong>
                  {p.a} ↔ {p.b}
                </strong>
                <span class="dim">
                  {t('tx.pairRow', { best: p.best, n: p.sessions })} · {fmtDate(p.lastDate)}
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

export function ChordsScreen() {
  const view = route.value.rest[0] === 'practice' ? 'practice' : 'library';
  return (
    <div class="stack">
      <Segmented
        label={t('nav.chords')}
        options={[
          { value: 'library', label: t('chords.library') },
          { value: 'practice', label: t('chords.practice') },
        ]}
        value={view}
        onChange={(v) => (v === 'practice' ? navigate('chords', 'practice') : navigate('chords'))}
        testid="chords-view"
      />
      {view === 'library' ? <Library /> : <Practice />}
    </div>
  );
}
