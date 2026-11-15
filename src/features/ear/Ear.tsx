import { useEffect, useRef, useState } from 'preact/hooks';
import { masterOut, resumeAudio } from '../../audio/engine';
import { playNote, strumChord } from '../../audio/synth/guitar';
import { dbAll, dbPut, newId } from '../../db/db';
import { persistent } from '../../db/persist';
import { midiToFreq } from '../../dsp/notes';
import { t, type Key } from '../../i18n';
import {
  EAR_PASS,
  EAR_ROUND,
  earLevels,
  earScore,
  isEarResult,
  isPass,
  itemAccuracy,
  makeRound,
  questionNotes,
  tally,
  unlockedLevel,
  type EarKind,
  type EarQuestion,
  type EarResult,
  type EarTally,
} from '../../music/ear';
import { QUALITIES, type Quality } from '../../music/theory';
import { settings } from '../../settings';
import { LineChart } from '../../ui/charts';
import { Card, Notice, Segmented } from '../../ui/controls';
import { Icon } from '../../ui/Icon';

interface EarState {
  kind: EarKind;
  /** Türe göre seçili seviye. */
  intervalLevel: number;
  chordLevel: number;
}

export const earStore = persistent<EarState>('ear', { kind: 'interval', intervalLevel: 1, chordLevel: 1 });

/** Doğru yanıttan sonra sıradaki soruya geçmeden önceki bekleme. */
const ADVANCE_MS = 800;
/** Sonraki seviye için gereken doğru sayısı. */
const NEED = Math.ceil((EAR_PASS / 100) * EAR_ROUND);

/** Yanıt düğmesindeki kısa ad: aralıkta "T5", akorda "maj7". */
function shortName(kind: EarKind, item: string): string {
  if (kind === 'interval') return t(`interval.short.${item}` as Key);
  return item === 'maj' ? 'maj' : QUALITIES[item as Quality].suffix;
}

function longName(kind: EarKind, item: string): string {
  return t((kind === 'interval' ? `interval.${item}` : `ear.chord.${item}`) as Key);
}

function fullName(kind: EarKind, item: string): string {
  return `${longName(kind, item)} (${shortName(kind, item)})`;
}

// Her çalma kendi kazanç düğümünden geçer: yeni soru çalınırken öncekinin kuyruğu kısılır, sesler karışmaz.
let bus: GainNode | null = null;

function silence(): void {
  if (!bus) return;
  const old = bus;
  bus = null;
  old.gain.setTargetAtTime(0, old.context.currentTime, 0.02);
  setTimeout(() => old.disconnect(), 400);
}

/**
 * Soruyu çalar.
 * @param item Verilirse aynı kökten o yanıt çalınır (yanlış yanıtı karşılaştırmak için).
 * @param apart Akorun notalarını tek tek çalar (ipucu).
 */
async function playQuestion(q: EarQuestion, item: string = q.item, apart = false): Promise<void> {
  const ctx = await resumeAudio();
  silence();
  const out = ctx.createGain();
  out.connect(masterOut());
  bus = out;
  const a4 = settings.a4.peek();
  const now = ctx.currentTime + 0.05;
  const notes = questionNotes(q, item);
  if (q.kind === 'chord' && !apart) {
    strumChord(notes.map((n) => n.midi), 'D', { when: now, a4, gain: 0.5, spread: 0.022, duration: 2.6, destination: out });
    return;
  }
  notes.forEach((n, i) => {
    playNote(midiToFreq(n.midi, a4), { when: now + (apart ? i * 0.4 : n.at), seconds: 1.5, gain: 0.6, destination: out });
  });
}

/** Seviye tanıtımında bir türün örneğini çalar (sabit kökten). */
function playExample(kind: EarKind, item: string): void {
  void playQuestion({ kind, item, rootMidi: kind === 'interval' ? 57 : 48, direction: kind === 'interval' ? 'up' : 'together' });
}

interface Round {
  kind: EarKind;
  level: number;
  questions: EarQuestion[];
  index: number;
  correct: number;
  tally: EarTally;
  startedAt: number;
  feedback: { ok: boolean; chosen: string } | null;
}

interface Summary {
  result: EarResult;
  /** Bu turla açılan seviye (yoksa null). */
  unlocked: number | null;
  missed: string[];
}

export function EarScreen() {
  const s = earStore.state.value;
  const lang = settings.lang.value;
  const kind = s.kind;
  const [history, setHistory] = useState<EarResult[] | null>(null);
  const [round, setRound] = useState<Round | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = async (): Promise<EarResult[]> => {
    const rows = ((await dbAll('results', 'ear')) as unknown[]).filter(isEarResult).sort((a, b) => a.date - b.date);
    setHistory(rows);
    return rows;
  };
  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    void load();
    return () => {
      clearTimer();
      silence();
    };
  }, []);

  const levels = earLevels(kind);
  const unlocked = history ? unlockedLevel(history, kind) : 1;
  const selected = kind === 'interval' ? s.intervalLevel : s.chordLevel;
  const level = Math.max(1, Math.min(selected, unlocked));
  const def = levels[level - 1];
  const setLevel = (n: number) => {
    setSummary(null);
    earStore.update(kind === 'interval' ? { intervalLevel: n } : { chordLevel: n });
  };

  const start = () => {
    setSummary(null);
    const questions = makeRound(kind, level, Math.random);
    setRound({ kind, level, questions, index: 0, correct: 0, tally: {}, startedAt: performance.now(), feedback: null });
    void playQuestion(questions[0]);
  };

  const finish = async (r: Round) => {
    const before = unlockedLevel(history ?? [], r.kind);
    const result: EarResult = {
      id: newId(),
      type: 'ear',
      date: Date.now(),
      kind: r.kind,
      level: r.level,
      correct: r.correct,
      total: r.questions.length,
      seconds: Math.round((performance.now() - r.startedAt) / 1000),
      items: r.tally,
    };
    await dbPut('results', result);
    const rows = await load();
    const after = unlockedLevel(rows, r.kind);
    const missed = Object.entries(r.tally)
      .filter(([, [asked, correct]]) => correct < asked)
      .map(([item]) => item);
    silence();
    setSummary({ result, unlocked: after > before ? after : null, missed });
    setRound(null);
  };

  const advance = (r: Round) => {
    clearTimer();
    if (r.index + 1 >= r.questions.length) {
      void finish(r);
      return;
    }
    const next: Round = { ...r, index: r.index + 1, feedback: null };
    setRound(next);
    void playQuestion(next.questions[next.index]);
  };

  const answer = (item: string) => {
    if (!round || round.feedback) return;
    const q = round.questions[round.index];
    const ok = item === q.item;
    const next: Round = {
      ...round,
      correct: round.correct + (ok ? 1 : 0),
      tally: tally(round.tally, q.item, ok),
      feedback: { ok, chosen: item },
    };
    setRound(next);
    // Doğruda kendiliğinden ilerler; yanlışta kullanıcı iki sesi karşılaştırıp "Sonraki"ye basar.
    if (ok) timer.current = setTimeout(() => advance(next), ADVANCE_MS);
  };

  const quit = () => {
    clearTimer();
    silence();
    setRound(null);
  };

  if (round) {
    const q = round.questions[round.index];
    const fb = round.feedback;
    const last = round.index + 1 >= round.questions.length;
    const roundDef = earLevels(round.kind)[round.level - 1];
    return (
      <div class="stack">
        <Card testid="ear-round" class="game">
          <div
            class="tx-status"
            data-testid="ear-progress"
            data-item={q.item}
            data-root={q.rootMidi}
            data-direction={q.direction}
            data-feedback={fb ? (fb.ok ? 'ok' : 'wrong') : ''}
          >
            {t('game.progress', { n: round.index + 1, total: round.questions.length })} · {t('game.correct', { n: round.correct })}
          </div>
          <p class="game-prompt" data-testid="ear-prompt">
            {t(round.kind === 'interval' ? 'ear.askInterval' : 'ear.askChord')}
            {round.kind === 'interval' && <small class="ear-direction">{t(`ear.dir.${q.direction}` as Key)}</small>}
          </p>
          <div class="row">
            <button type="button" class="btn primary big grow" onClick={() => void playQuestion(q)} data-testid="ear-replay">
              <Icon name="speaker" /> {t('ear.replay')}
            </button>
            {round.kind === 'chord' && (
              <button type="button" class="btn big" onClick={() => void playQuestion(q, q.item, true)} data-testid="ear-apart">
                {t('ear.apart')}
              </button>
            )}
          </div>
          <div class={`game-feedback ${fb ? (fb.ok ? 'good' : 'bad') : ''}`} data-testid="ear-feedback">
            {fb ? (fb.ok ? t('game.right') : t('ear.wrong', { answer: fullName(round.kind, q.item) })) : ' '}
          </div>
          {/* Yanlışta eylemler seçeneklerin üstünde: 12 seçenekli seviyelerde de kaydırmadan görünür. */}
          {fb && !fb.ok && (
            <div class="row">
              <button type="button" class="btn grow" onClick={() => void playQuestion(q, fb.chosen)} data-testid="ear-hear-chosen">
                <Icon name="speaker" /> {t('ear.hearChosen', { name: shortName(round.kind, fb.chosen) })}
              </button>
              <button type="button" class="btn primary grow" onClick={() => advance(round)} data-testid="ear-next">
                {last ? t('ear.finish') : t('ear.next')} <Icon name="chevron" />
              </button>
            </div>
          )}
          <div class={`answers ear ${roundDef.items.length < 3 ? 'pair' : ''}`} data-testid="ear-answers">
            {roundDef.items.map((item) => (
              <button
                type="button"
                class={`btn answer two ${fb && item === q.item ? 'good' : ''} ${fb && !fb.ok && item === fb.chosen ? 'bad' : ''}`}
                onClick={() => answer(item)}
                disabled={!!fb}
                data-testid={`ear-answer-${item}`}
              >
                <strong>{shortName(round.kind, item)}</strong>
                <small>{longName(round.kind, item)}</small>
              </button>
            ))}
          </div>
          <button type="button" class="btn block" onClick={quit} data-testid="ear-quit">
            <Icon name="stop" /> {t('common.cancel')}
          </button>
        </Card>
      </div>
    );
  }

  const same = (history ?? []).filter((h) => h.kind === kind && h.level === level && h.total >= EAR_ROUND);
  const scores = same.map((h) => earScore(h.correct, h.total));
  const accuracy = itemAccuracy(history ?? [], kind);
  const fmtDate = (d: number) => new Date(d).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' });

  return (
    <div class="stack">
      <Segmented
        label={t('nav.ear')}
        options={[
          { value: 'interval' as const, label: t('ear.intervals') },
          { value: 'chord' as const, label: t('ear.chords') },
        ]}
        value={kind}
        onChange={(k) => {
          setSummary(null);
          earStore.update({ kind: k });
        }}
        testid="ear-kind"
      />
      <Card testid="ear-setup">
        <p class="help">{t('ear.intro', { n: EAR_ROUND })}</p>
        {summary && (
          <Notice kind={isPass(summary.result) ? 'good' : 'info'} testid="ear-summary">
            {t('game.summary', { correct: summary.result.correct, total: summary.result.total, seconds: summary.result.seconds })}
            {summary.unlocked !== null && ` ${t('ear.unlocked', { n: summary.unlocked })}`}
            {!isPass(summary.result) && unlocked === level && level < levels.length && ` ${t('ear.passHint', { need: NEED })}`}
            {summary.missed.length > 0 &&
              ` ${t('ear.missed', { list: summary.missed.map((m) => shortName(summary.result.kind, m)).join(', ') })}`}
          </Notice>
        )}
        {summary?.unlocked != null && (
          <button type="button" class="btn block" onClick={() => setLevel(summary.unlocked!)} data-testid="ear-go-next">
            {t('ear.goNext')} <Icon name="chevron" />
          </button>
        )}
        <div class="field">
          <span class="field-label">{t('ear.level')}</span>
          <div class="root-grid" role="radiogroup" aria-label={t('ear.level')} data-testid="ear-levels">
            {levels.map((_, i) => {
              const n = i + 1;
              const locked = n > unlocked;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={n === level}
                  aria-label={t(locked ? 'ear.levelLocked' : 'ear.levelN', { n })}
                  class={`chip ${n === level ? 'active' : ''} ${locked ? 'locked' : ''}`}
                  disabled={locked}
                  onClick={() => setLevel(n)}
                  data-testid={`ear-level-${n}`}
                >
                  {locked ? <Icon name="lock" size={18} /> : n}
                </button>
              );
            })}
          </div>
        </div>
        <div class="field">
          <span class="field-label">{t('ear.inLevel')}</span>
          <div class="chips" data-testid="ear-items">
            {def.items.map((item) => (
              <button type="button" class="chip" onClick={() => playExample(kind, item)} data-testid={`ear-example-${item}`}>
                {fullName(kind, item)}
              </button>
            ))}
          </div>
          {kind === 'interval' && (
            <p class="help" data-testid="ear-directions">
              {t('ear.directions', { list: def.directions.map((d) => t(`ear.dir.${d}` as Key)).join(', ') })}
            </p>
          )}
        </div>
        <button type="button" class="btn primary block big" onClick={start} disabled={!history} data-testid="ear-start">
          <Icon name="play" /> {summary ? t('game.again') : t('ear.start')}
        </button>
        <p class="help" data-testid="ear-unlock-hint">
          {unlocked >= levels.length
            ? t('ear.allUnlocked')
            : t('ear.unlockHint', { n: unlocked + 1, level: unlocked, need: NEED, total: EAR_ROUND })}
        </p>
      </Card>

      <Card title={t('ear.history', { n: level })} testid="ear-history">
        {same.length === 0 ? (
          <p class="help" data-testid="ear-empty">{t('ear.noHistory')}</p>
        ) : (
          <>
            <div class="stats">
              <div class="stat accent">
                <span class="stat-value" data-testid="ear-best">{Math.max(...scores)}</span>
                <span class="stat-label">{t('game.best')}</span>
              </div>
              <div class="stat">
                <span class="stat-value" data-testid="ear-last">{scores[scores.length - 1]}</span>
                <span class="stat-label">{t('tx.last')}</span>
              </div>
              <div class="stat">
                <span class="stat-value" data-testid="ear-avg">{Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)}</span>
                <span class="stat-label">{t('tx.avg')}</span>
              </div>
              <div class="stat">
                <span class="stat-value" data-testid="ear-rounds">{same.length}</span>
                <span class="stat-label">{t('game.rounds')}</span>
              </div>
            </div>
            {same.length > 1 && (
              <>
                <LineChart
                  title={t('ear.chart')}
                  points={same.slice(-30).map((r) => ({ value: earScore(r.correct, r.total), label: fmtDate(r.date) }))}
                  testid="ear-chart"
                />
                <p class="help center">{t('ear.chart')}</p>
              </>
            )}
          </>
        )}
      </Card>

      {accuracy.length > 0 && (
        <Card title={t('ear.accuracy')} testid="ear-accuracy">
          <p class="help">{t('ear.accuracyHelp')}</p>
          <div class="acc-list">
            {accuracy.map((a) => (
              <div class="acc-row" data-testid={`ear-acc-${a.item}`} data-percent={a.percent}>
                <span class="acc-name">{fullName(kind, a.item)}</span>
                <span class="acc-bar">
                  <span class={a.percent < 60 ? 'bad' : a.percent < EAR_PASS ? 'warn' : 'good'} style={{ width: `${Math.max(4, a.percent)}%` }} />
                </span>
                <span class="acc-value">
                  {lang === 'tr' ? `%${a.percent}` : `${a.percent}%`} <small>{t('ear.asked', { n: a.asked })}</small>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
