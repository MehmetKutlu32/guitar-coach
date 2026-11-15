import { useEffect, useRef, useState } from 'preact/hooks';
import { audioCtx, resumeAudio } from '../../audio/engine';
import { playNote } from '../../audio/synth/guitar';
import { dbAll, dbPut, newId } from '../../db/db';
import { persistent } from '../../db/persist';
import { midiToFreq } from '../../dsp/notes';
import { t, type Key } from '../../i18n';
import {
  answerChoices,
  arpeggioDegree,
  arpeggioDots,
  ARPEGGIO_QUALITIES,
  CAGED_ORDER,
  cagedPosition,
  checkAnswer,
  degreeLabel,
  gameScore,
  isGameResult,
  nextQuestion,
  noteAt,
  parentMajorRoot,
  scaleDots,
  scaleSteps,
  type CagedShape,
  type GameMode,
  type GameQuestion,
  type GameResult,
  type GameSettings,
  type NeckDot,
} from '../../music/fretboard';
import { namesForScale, scaleNoteNames, scaleRootName, SCALE_IDS, SCALES, type ScaleId } from '../../music/scales';
import { chordSymbol, COMMON_NAMES, FLAT_NAMES, mod12, QUALITIES, SHARP_NAMES, type Quality } from '../../music/theory';
import { settings } from '../../settings';
import { Card, Notice, Segmented, Toggle } from '../../ui/controls';
import { Fretboard, type FretDot } from '../../ui/Fretboard';
import { Icon } from '../../ui/Icon';

type View = 'scales' | 'arpeggios' | 'caged' | 'game';

interface TheoryState {
  view: View;
  root: number;
  scale: ScaleId;
  quality: Quality;
  shape: CagedShape;
  labels: 'note' | 'degree';
  /** Sap penceresinin başlangıcı (0, 5 ya da 12). */
  start: number;
  gameMode: GameMode;
  gameMaxFret: number;
  gameNaturals: boolean;
}

export const theoryStore = persistent<TheoryState>('theory', {
  view: 'scales',
  root: 9,
  scale: 'minorPent',
  quality: 'min',
  shape: 'E',
  labels: 'note',
  start: 0,
  gameMode: 'name',
  gameMaxFret: 5,
  gameNaturals: true,
});

const ROUND = 10;
const FEEDBACK_MS = 550;
/** Yanlış yanıtta doğrusu okunabilsin diye geri bildirim daha uzun kalır. */
const FEEDBACK_WRONG_MS = 1400;

/** Diyezli/bemollü notalar için iki yazım birden: "C#/Db". */
function pcLabel(pc: number): string {
  return SHARP_NAMES[pc] === FLAT_NAMES[pc] ? SHARP_NAMES[pc] : `${SHARP_NAMES[pc]}/${FLAT_NAMES[pc]}`;
}

async function playMidi(midi: number, when = 0, seconds = 1.2): Promise<void> {
  const ctx = await resumeAudio();
  playNote(midiToFreq(midi, settings.a4.peek()), { when: ctx.currentTime + when, seconds, gain: 0.6 });
}

/** Aralıkları kökten bir oktav çıkıp inerek çalar. */
async function playIntervals(root: number, intervals: number[]): Promise<void> {
  await resumeAudio();
  // Kök C3–G3 arasında; daha tiz kökler bir oktav aşağıdan başlar (gitarın rahat bölgesi).
  const base = (root >= 8 ? 36 : 48) + mod12(root);
  const up = [...intervals, 12].map((i) => base + i);
  const seq = [...up, ...[...up].reverse().slice(1)];
  const step = 0.26;
  const now = audioCtx().currentTime + 0.05;
  seq.forEach((midi, i) => {
    playNote(midiToFreq(midi, settings.a4.peek()), { when: now + i * step, seconds: step * 1.6, gain: 0.6 });
  });
}

function RootPicker(props: { value: number; onChange: (pc: number) => void }) {
  return (
    <div class="root-grid" role="radiogroup" aria-label={t('chords.root')} data-testid="theory-root">
      {COMMON_NAMES.map((name, i) => (
        <button
          type="button"
          role="radio"
          aria-checked={i === props.value}
          class={`chip ${i === props.value ? 'active' : ''}`}
          onClick={() => props.onChange(i)}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

function NeckControls() {
  const s = theoryStore.state.value;
  return (
    <>
      <Segmented
        label={t('theory.labels')}
        options={[
          { value: 'note' as const, label: t('theory.labelNote') },
          { value: 'degree' as const, label: t('theory.labelDegree') },
        ]}
        value={s.labels}
        onChange={(labels) => theoryStore.update({ labels })}
        testid="theory-labels"
      />
      <Segmented
        label={t('theory.window')}
        options={[0, 5, 12].map((n) => ({ value: n, label: n === 0 ? '0–12' : `${n + 1}–${n + 12}` }))}
        value={s.start}
        onChange={(start) => theoryStore.update({ start })}
        testid="theory-window"
      />
    </>
  );
}

function toDots(dots: NeckDot[], names: readonly string[], label: (d: NeckDot) => string, useDegree: boolean): FretDot[] {
  return dots.map((d) => ({
    string: d.string,
    fret: d.fret,
    label: useDegree ? label(d) : names[d.pc],
    kind: d.interval === 0 ? 'root' : 'tone',
  }));
}

const tapToPlay = (d: FretDot) => void playMidi(noteAt(d.string, d.fret));

function ScalesView() {
  const s = theoryStore.state.value;
  const def = SCALES[s.scale];
  const names = namesForScale(s.root, s.scale);
  const dots = toDots(scaleDots(s.root, s.scale, 0, 24), names, (d) => degreeLabel(d.interval, def.intervals), s.labels === 'degree');
  const parent = parentMajorRoot(s.root, s.scale);
  const steps = scaleSteps(s.scale).map((n) => (n === 1 ? t('theory.half') : n === 2 ? t('theory.whole') : t('theory.wholeHalf')));
  return (
    <>
      <Card testid="theory-scales">
        <RootPicker value={s.root} onChange={(root) => theoryStore.update({ root })} />
        <select
          class="select"
          aria-label={t('theory.scale')}
          value={s.scale}
          onChange={(e) => theoryStore.update({ scale: (e.target as HTMLSelectElement).value as ScaleId })}
          data-testid="theory-scale"
        >
          {SCALE_IDS.map((id) => (
            <option value={id}>{t(SCALES[id].name)}</option>
          ))}
        </select>
        <NeckControls />
        <Fretboard
          dots={dots}
          start={s.start}
          onTap={tapToPlay}
          title={`${scaleRootName(s.root, s.scale)} ${t(def.name)}`}
          testid="neck"
        />
        <button type="button" class="btn block" onClick={() => void playIntervals(s.root, def.intervals)} data-testid="theory-play">
          <Icon name="speaker" /> {t('theory.playScale')}
        </button>
      </Card>
      <Card title={`${scaleRootName(s.root, s.scale)} ${t(def.name)}`} testid="theory-info">
        <div class="degree-row" data-testid="scale-notes">
          {scaleNoteNames(s.root, s.scale).map((n, i) => (
            <span class={`degree ${i === 0 ? 'root' : ''}`}>
              <strong>{n}</strong>
              <small>{degreeLabel(def.intervals[i], def.intervals)}</small>
            </span>
          ))}
        </div>
        <p class="help" data-testid="scale-formula">
          {t('theory.formula')}: {steps.join(' – ')}
        </p>
        {parent !== null && (
          <p class="help" data-testid="scale-parent">
            {t('theory.parent', {
              mode: `${scaleRootName(s.root, s.scale)} ${t(def.name)}`,
              major: names[parent],
              degree: SCALES.major.intervals.indexOf(mod12(s.root - parent)) + 1,
            })}
          </p>
        )}
        <p class="help">{t('theory.tapHint')}</p>
      </Card>
    </>
  );
}

function ArpeggiosView() {
  const s = theoryStore.state.value;
  const names = namesForScale(s.root, QUALITIES[s.quality].intervals.includes(3) ? 'minor' : 'major');
  const dots = toDots(arpeggioDots(s.root, s.quality, 0, 24), names, (d) => arpeggioDegree(d.interval, s.quality), s.labels === 'degree');
  const symbol = chordSymbol(s.root, s.quality, names);
  return (
    <>
      <Card testid="theory-arpeggios">
        <RootPicker value={s.root} onChange={(root) => theoryStore.update({ root })} />
        <select
          class="select"
          aria-label={t('theory.chordType')}
          value={s.quality}
          onChange={(e) => theoryStore.update({ quality: (e.target as HTMLSelectElement).value as Quality })}
          data-testid="theory-quality"
        >
          {ARPEGGIO_QUALITIES.map((q) => (
            <option value={q}>{t(`quality.${q}` as Key)}</option>
          ))}
        </select>
        <NeckControls />
        <Fretboard dots={dots} start={s.start} onTap={tapToPlay} title={t('theory.arpeggioOf', { name: symbol })} testid="neck" />
        <button
          type="button"
          class="btn block"
          onClick={() => void playIntervals(s.root, QUALITIES[s.quality].intervals)}
          data-testid="theory-play"
        >
          <Icon name="speaker" /> {t('theory.playArpeggio')}
        </button>
      </Card>
      <Card title={t('theory.arpeggioOf', { name: symbol })} testid="theory-info">
        <div class="degree-row" data-testid="arpeggio-notes">
          {QUALITIES[s.quality].intervals.map((iv, i) => (
            <span class={`degree ${i === 0 ? 'root' : ''}`}>
              <strong>{names[mod12(s.root + iv)]}</strong>
              <small>{arpeggioDegree(iv, s.quality)}</small>
            </span>
          ))}
        </div>
        <p class="help">{t('theory.arpeggioHelp')}</p>
      </Card>
    </>
  );
}

function CagedView() {
  const s = theoryStore.state.value;
  const pos = cagedPosition(s.root, s.shape);
  const names = namesForScale(s.root, 'major');
  const start = pos.toFret <= 12 ? 0 : pos.toFret <= 17 ? 5 : 12;
  const chord = toDots(pos.dots, names, (d) => arpeggioDegree(d.interval, 'maj'), s.labels === 'degree');
  const taken = new Set(pos.dots.map((d) => `${d.string}:${d.fret}`));
  // Biçimin çevresindeki majör gam notaları soluk gösterilir: akor, gamın içinde nerede duruyor?
  const around: FretDot[] = scaleDots(s.root, 'major', Math.max(0, pos.fromFret - 1), pos.toFret + 1)
    .filter((d) => !taken.has(`${d.string}:${d.fret}`))
    .map((d) => ({
      string: d.string,
      fret: d.fret,
      label: s.labels === 'degree' ? degreeLabel(d.interval, SCALES.major.intervals) : names[d.pc],
      kind: 'faded' as const,
    }));
  return (
    <>
      <Card testid="theory-caged">
        <RootPicker value={s.root} onChange={(root) => theoryStore.update({ root })} />
        <Segmented
          label={t('theory.shape')}
          options={CAGED_ORDER.map((sh) => ({ value: sh, label: sh }))}
          value={s.shape}
          onChange={(shape) => theoryStore.update({ shape })}
          testid="caged-shape"
        />
        <Segmented
          label={t('theory.labels')}
          options={[
            { value: 'note' as const, label: t('theory.labelNote') },
            { value: 'degree' as const, label: t('theory.labelDegree') },
          ]}
          value={s.labels}
          onChange={(labels) => theoryStore.update({ labels })}
          testid="theory-labels"
        />
        <Fretboard
          dots={[...around, ...chord]}
          start={start}
          onTap={tapToPlay}
          title={t('theory.cagedTitle', { name: names[s.root], shape: s.shape })}
          testid="neck"
        />
        <p class="help" data-testid="caged-info">
          {t('theory.cagedInfo', { name: names[s.root], shape: s.shape, from: pos.fromFret, to: pos.toFret })}
        </p>
      </Card>
      <Card title="CAGED" testid="theory-info">
        <p class="help">{t('theory.cagedHelp')}</p>
      </Card>
    </>
  );
}

interface Round {
  question: GameQuestion;
  asked: number;
  correct: number;
  startedAt: number;
  /** Son yanıtın geri bildirimi gösterilirken dolu. */
  feedback: { ok: boolean; answer: number } | null;
  missed: GameQuestion[];
}

function GameView() {
  const s = theoryStore.state.value;
  const [round, setRound] = useState<Round | null>(null);
  const [summary, setSummary] = useState<GameResult | null>(null);
  const [history, setHistory] = useState<GameResult[]>([]);
  const [missed, setMissed] = useState<GameQuestion[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gameSettings: GameSettings = {
    mode: s.gameMode,
    maxFret: s.gameMaxFret,
    naturalsOnly: s.gameNaturals,
    strings: [0, 1, 2, 3, 4, 5],
  };

  const load = () =>
    dbAll('results', 'fretgame').then((rows) => setHistory((rows as unknown[]).filter(isGameResult).sort((a, b) => a.date - b.date)));
  useEffect(() => {
    void load();
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const start = () => {
    setSummary(null);
    setRound({
      question: nextQuestion(gameSettings, null, Math.random),
      asked: 0,
      correct: 0,
      startedAt: performance.now(),
      feedback: null,
      missed: [],
    });
  };

  const finish = async (r: Round) => {
    const result: GameResult = {
      id: newId(),
      type: 'fretgame',
      date: Date.now(),
      mode: s.gameMode,
      maxFret: s.gameMaxFret,
      naturalsOnly: s.gameNaturals,
      correct: r.correct,
      total: r.asked,
      seconds: Math.round((performance.now() - r.startedAt) / 1000),
    };
    await dbPut('results', result);
    await load();
    setMissed(r.missed);
    setSummary(result);
    setRound(null);
  };

  const answer = (value: number) => {
    if (!round || round.feedback) return;
    const ok = checkAnswer(s.gameMode, round.question, value);
    void playMidi(noteAt(round.question.string, round.question.fret), 0, 0.8);
    const next: Round = {
      ...round,
      asked: round.asked + 1,
      correct: round.correct + (ok ? 1 : 0),
      feedback: { ok, answer: value },
      missed: ok ? round.missed : [...round.missed, round.question],
    };
    setRound(next);
    timer.current = setTimeout(() => {
      if (next.asked >= ROUND) void finish(next);
      else setRound({ ...next, feedback: null, question: nextQuestion(gameSettings, next.question, Math.random) });
    }, ok ? FEEDBACK_MS : FEEDBACK_WRONG_MS);
  };

  const same = history.filter((h) => h.mode === s.gameMode && h.maxFret === s.gameMaxFret && h.naturalsOnly === s.gameNaturals);
  const best = same.reduce((m, h) => Math.max(m, gameScore(h.correct, h.total)), 0);

  if (round) {
    const q = round.question;
    const names = SHARP_NAMES;
    const stringNo = 6 - q.string;
    const dot: FretDot = {
      string: q.string,
      fret: q.fret,
      label: round.feedback ? names[q.pc] : '?',
      kind: round.feedback ? (round.feedback.ok ? 'good' : 'bad') : 'target',
    };
    return (
      <Card testid="game" class="game">
        <div
          class="tx-status"
          data-testid="game-progress"
          data-string={q.string}
          data-fret={q.fret}
          data-pc={q.pc}
          data-feedback={round.feedback ? (round.feedback.ok ? 'ok' : 'wrong') : ''}
        >
          {t('game.progress', { n: Math.min(ROUND, round.asked + (round.feedback ? 0 : 1)), total: ROUND })} ·{' '}
          {t('game.correct', { n: round.correct })}
        </div>
        <p class="game-prompt" data-testid="game-prompt">
          {s.gameMode === 'name'
            ? t('game.askName')
            : t('game.askFind', { string: stringNo, open: names[mod12(noteAt(q.string, 0))], note: pcLabel(q.pc) })}
        </p>
        <Fretboard
          dots={s.gameMode === 'name' || round.feedback ? [dot] : []}
          start={0}
          highlightString={q.string}
          title={t('game.neck')}
          testid="neck"
        />
        <div class={`game-feedback ${round.feedback ? (round.feedback.ok ? 'good' : 'bad') : ''}`} data-testid="game-feedback">
          {round.feedback
            ? round.feedback.ok
              ? t('game.right')
              : t('game.wrong', { note: pcLabel(q.pc), fret: q.fret })
            : ' '}
        </div>
        {s.gameMode === 'name' ? (
          <div class="answers" data-testid="answers">
            {answerChoices(gameSettings).map((pc) => (
              <button type="button" class="btn answer" onClick={() => answer(pc)} disabled={!!round.feedback} data-testid={`answer-pc-${pc}`}>
                {pcLabel(pc)}
              </button>
            ))}
          </div>
        ) : (
          <div class="answers frets" data-testid="answers">
            {Array.from({ length: s.gameMaxFret }, (_, i) => i + 1).map((f) => (
              <button type="button" class="btn answer" onClick={() => answer(f)} disabled={!!round.feedback} data-testid={`answer-fret-${f}`}>
                {f}
              </button>
            ))}
          </div>
        )}
        <button type="button" class="btn block" onClick={() => setRound(null)} data-testid="game-quit">
          <Icon name="stop" /> {t('common.cancel')}
        </button>
      </Card>
    );
  }

  return (
    <>
      <Card testid="game-setup">
        <p class="help">{t('game.intro')}</p>
        {summary && (
          <Notice kind="good" testid="game-summary">
            {t('game.summary', { correct: summary.correct, total: summary.total, seconds: summary.seconds })}
            {missed.length > 0 &&
              ` ${t('game.missed', {
                list: [...new Set(missed.map((m) => `${SHARP_NAMES[m.pc]} (${6 - m.string}. ${t('game.stringWord')}, ${m.fret})`))].join(', '),
              })}`}
          </Notice>
        )}
        <div class="field">
          <span class="field-label">{t('game.mode')}</span>
          <Segmented
            label={t('game.mode')}
            options={[
              { value: 'name' as const, label: t('game.modeName') },
              { value: 'find' as const, label: t('game.modeFind') },
            ]}
            value={s.gameMode}
            onChange={(gameMode) => theoryStore.update({ gameMode })}
            testid="game-mode"
          />
        </div>
        <div class="field">
          <span class="field-label">{t('game.range')}</span>
          <Segmented
            label={t('game.range')}
            options={[5, 12].map((n) => ({ value: n, label: t('game.rangeN', { n }) }))}
            value={s.gameMaxFret}
            onChange={(gameMaxFret) => theoryStore.update({ gameMaxFret })}
            testid="game-range"
          />
        </div>
        <Toggle
          label={t('game.naturals')}
          checked={s.gameNaturals}
          onChange={(gameNaturals) => theoryStore.update({ gameNaturals })}
          testid="game-naturals"
        />
        <button type="button" class="btn primary block big" onClick={start} data-testid="game-start">
          <Icon name="play" /> {summary ? t('game.again') : t('game.start')}
        </button>
      </Card>
      <Card title={t('game.history')} testid="game-history">
        {same.length === 0 ? (
          <p class="help" data-testid="game-empty">{t('game.noHistory')}</p>
        ) : (
          <div class="stats">
            <div class="stat accent">
              <span class="stat-value" data-testid="game-best">{best}</span>
              <span class="stat-label">{t('game.best')}</span>
            </div>
            <div class="stat">
              <span class="stat-value">{gameScore(same[same.length - 1].correct, same[same.length - 1].total)}</span>
              <span class="stat-label">{t('tx.last')}</span>
            </div>
            <div class="stat">
              <span class="stat-value" data-testid="game-rounds">{same.length}</span>
              <span class="stat-label">{t('game.rounds')}</span>
            </div>
            <div class="stat">
              <span class="stat-value">{Math.min(...same.map((h) => h.seconds))}</span>
              <span class="stat-label">{t('game.fastest')}</span>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

export function TheoryScreen() {
  const s = theoryStore.state.value;
  return (
    <div class="stack">
      <Segmented
        label={t('nav.theory')}
        options={[
          { value: 'scales' as const, label: t('theory.scales') },
          { value: 'arpeggios' as const, label: t('theory.arpeggios') },
          { value: 'caged' as const, label: 'CAGED' },
          { value: 'game' as const, label: t('theory.game') },
        ]}
        value={s.view}
        onChange={(view) => theoryStore.update({ view })}
        testid="theory-view"
      />
      {s.view === 'scales' && <ScalesView />}
      {s.view === 'arpeggios' && <ArpeggiosView />}
      {s.view === 'caged' && <CagedView />}
      {s.view === 'game' && <GameView />}
    </div>
  );
}
