import { useEffect, useState } from 'preact/hooks';
import { dbAll } from '../../db/db';
import { persistent } from '../../db/persist';
import { t, type Key } from '../../i18n';
import { href, navigate } from '../../router';
import { Card, Notice, Segmented } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { isEarResult } from '../../music/ear';
import { isGameResult } from '../../music/fretboard';
import { parseChordPro } from '../../music/chordpro';
import { isTab } from '../../music/tab';
import { backingStore } from '../backing/Backing';
import { chordsStore } from '../chords/Chords';
import { isTransitionResult } from '../chords/transitions';
import { earStore } from '../ear/Ear';
import { dayKey, isSessionRecord } from '../log/stats';
import { metroStore } from '../metronome/Metronome';
import { isRhythmResult } from '../rhythm/analysis';
import { rhythmStore } from '../rhythm/Rhythm';
import { BUILTIN_SONGS, isSongRecord } from '../songs/builtin';
import { openSongAt } from '../songs/Songs';
import { BUILTIN_TABS } from '../tabs/builtin';
import { tabsStore } from '../tabs/Tabs';
import { theoryStore } from '../theory/Theory';
import {
  autoDone,
  DEFAULT_PROFILE,
  generatePlan,
  QUESTIONS,
  scoreProfile,
  type PlanInput,
  type PlanItem,
  type PlanMinutes,
  type PlanSetup,
  type Profile,
  type Question,
  type Text,
} from './generator';

interface PlanState {
  /** Seviye testi sonucu; test hiç yapılmadıysa null. */
  profile: Profile | null;
  minutes: PlanMinutes;
  /** Elle işaretlenen maddelerin ait olduğu gün. */
  doneDate: string;
  done: string[];
}

export const planStore = persistent<PlanState>('plan', {
  profile: null,
  minutes: 30,
  doneDate: '',
  done: [],
});

const text = (x: Text) => {
  const refs = Object.fromEntries(Object.entries(x.refs ?? {}).map(([k, key]) => [k, t(key)]));
  return t(x.key, { ...x.params, ...refs });
};

type PlanData = Omit<PlanInput, 'profile' | 'minutes' | 'today'>;

/** Planın dayandığı tüm kayıtları okur: sonuçlar, oturumlar, şarkılar ve tablar (hazırlar dahil). */
async function loadPlanData(): Promise<PlanData> {
  const [tr, rh, se, ear, game, songs, tabs] = await Promise.all([
    dbAll('results', 'transition'),
    dbAll('results', 'rhythm'),
    dbAll('sessions'),
    dbAll('results', 'ear'),
    dbAll('results', 'fretgame'),
    dbAll('items', 'song'),
    dbAll('items', 'tab'),
  ]);
  const songList = [...BUILTIN_SONGS, ...(songs as unknown[]).filter(isSongRecord)].map((r) => {
    const song = parseChordPro(r.text);
    return { id: r.id, name: song.title.trim() || t('songs.untitled'), bpm: song.tempo ?? r.bpm };
  });
  const tabList = [...BUILTIN_TABS, ...(tabs as unknown[]).filter(isTab)].map((tab) => ({ id: tab.id, name: tab.name, bpm: tab.bpm }));
  return {
    transitions: (tr as unknown[]).filter(isTransitionResult),
    rhythm: (rh as unknown[]).filter(isRhythmResult),
    sessions: (se as unknown[]).filter(isSessionRecord),
    ear: (ear as unknown[]).filter(isEarResult),
    fretgame: (game as unknown[]).filter(isGameResult),
    songs: songList,
    tabs: tabList,
  };
}

/** Plan maddesinin ayarlarını ilgili araca uygular ve o ekrana gider. */
export function startItem(setup: PlanSetup): void {
  switch (setup.kind) {
    case 'tune':
      navigate('tuner');
      break;
    case 'transition':
      chordsStore.update({ a: setup.a, b: setup.b, seconds: setup.seconds });
      navigate('chords', 'practice');
      break;
    case 'rhythm':
      rhythmStore.update({ source: 'metronome', bpm: setup.bpm, what: setup.what, bars: setup.bars });
      navigate('rhythm');
      break;
    case 'pattern':
      metroStore.update({ bpm: setup.bpm, meter: '4/4', accents: [2, 1, 1, 1], subdivision: 1, patternId: setup.patternId });
      navigate('metronome');
      break;
    case 'backing':
      backingStore.update({ progressionId: setup.progressionId, key: setup.key, bpm: setup.bpm, style: setup.style });
      navigate('backing');
      break;
    case 'ear':
      earStore.update(
        setup.earKind === 'interval' ? { kind: 'interval', intervalLevel: setup.level } : { kind: 'chord', chordLevel: setup.level },
      );
      navigate('ear');
      break;
    case 'fretgame':
      theoryStore.update({ view: 'game', gameMode: setup.mode, gameMaxFret: setup.maxFret, gameNaturals: setup.naturals });
      navigate('theory');
      break;
    case 'scale':
      theoryStore.update({ view: 'scales', root: setup.root, scale: setup.scale });
      navigate('theory');
      break;
    case 'song':
      void openSongAt(setup.id, setup.bpm);
      break;
    case 'tab':
      tabsStore.update({ speed: setup.speed });
      navigate('tabs', setup.id);
      break;
  }
}

/** İlk açılıştaki kısa seviye testi: her adımda tek soru, büyük seçenek düğmeleri. */
export function LevelTest() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<Question['id'], number>>>({});
  const q = QUESTIONS[step];

  const answer = (value: number) => {
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    if (step + 1 < QUESTIONS.length) {
      setStep(step + 1);
      return;
    }
    planStore.update({ profile: scoreProfile(next, Date.now()) });
    navigate('home');
  };

  return (
    <div class="stack">
      <Card testid="level-test">
        <div class="test-progress" aria-hidden="true">
          {QUESTIONS.map((_, i) => (
            <span class={`test-pip ${i < step ? 'done' : i === step ? 'now' : ''}`} />
          ))}
        </div>
        <p class="tx-status" data-testid="test-step">
          {t('test.step', { n: step + 1, total: QUESTIONS.length })}
        </p>
        <h2 class="test-question" data-testid="test-question">
          {t(q.text)}
        </h2>
        <div class="test-options">
          {q.options.map((o) => (
            <button
              type="button"
              class={`btn block test-option ${answers[q.id] === o.value ? 'chosen' : ''}`}
              onClick={() => answer(o.value)}
              data-testid={`answer-${o.value}`}
            >
              {t(o.text)}
            </button>
          ))}
        </div>
        <div class="row">
          {step > 0 && (
            <button type="button" class="btn grow" onClick={() => setStep(step - 1)} data-testid="test-back">
              <Icon name="back" /> {t('common.back')}
            </button>
          )}
          <a class="btn grow" href={href('home')} data-testid="test-cancel">
            {t('common.cancel')}
          </a>
        </div>
      </Card>
    </div>
  );
}

function PlanRow(props: { item: PlanItem; done: boolean; auto: boolean; onToggle: () => void }) {
  const { item, done } = props;
  const title = text(item.title);
  return (
    <div class={`plan-row ${done ? 'done' : ''}`} data-testid={`plan-item-${item.setup.kind}`} data-id={item.id}>
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={t('plan.markDone', { name: title })}
        class="plan-check"
        onClick={props.onToggle}
        disabled={props.auto}
        data-testid="plan-check"
      >
        {done && <Icon name="check" size={22} />}
      </button>
      <div class="plan-text">
        <strong>{title}</strong>
        <span class="dim">{text(item.reason)}</span>
      </div>
      <div class="plan-side">
        <span class="plan-min">{t('plan.min', { n: item.minutes })}</span>
        <button type="button" class="btn plan-start" onClick={() => startItem(item.setup)} data-testid="plan-start">
          {t('plan.start')}
        </button>
      </div>
    </div>
  );
}

/** Ana sayfadaki "Bugünün planı" kartı (ya da test yapılmadıysa karşılama kartı). */
export function TodayPlan() {
  const s = planStore.state.value;
  const [data, setData] = useState<PlanData | null>(null);

  useEffect(() => {
    let alive = true;
    void loadPlanData().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!s.profile) {
    return (
      <Card title={t('home.welcome')} testid="welcome">
        <p class="lead">{t('home.welcomeText')}</p>
        <a class="btn primary block big" href={href('home', 'test')} data-testid="test-start">
          {t('home.testStart')}
        </a>
        <button
          type="button"
          class="btn block"
          onClick={() => planStore.update({ profile: { ...DEFAULT_PROFILE, date: Date.now() } })}
          data-testid="test-skip"
        >
          {t('home.testSkip')}
        </button>
      </Card>
    );
  }
  if (!data) return null;

  const today = dayKey(Date.now());
  const items = generatePlan({ profile: s.profile, minutes: s.minutes, today, ...data });
  const auto = autoDone(items, { today, ...data });
  const manual = s.doneDate === today ? s.done : [];
  const isDone = (id: string) => auto.includes(id) || manual.includes(id);
  const doneCount = items.filter((it) => isDone(it.id)).length;
  const toggle = (id: string) =>
    planStore.update({ doneDate: today, done: manual.includes(id) ? manual.filter((x) => x !== id) : [...manual, id] });

  return (
    <Card title={t('plan.title')} testid="plan">
      <Segmented
        label={t('plan.minutes')}
        options={([15, 30, 45] as PlanMinutes[]).map((n) => ({ value: n, label: t('plan.min', { n }) }))}
        value={s.minutes}
        onChange={(minutes) => planStore.update({ minutes })}
        testid="plan-minutes"
      />
      <div class="plan-progress">
        <div class="hbar-track">
          <div class="hbar-fill" style={{ width: `${(doneCount / items.length) * 100}%` }} />
        </div>
        <span class="dim" data-testid="plan-progress">
          {t('plan.progress', { done: doneCount, total: items.length })}
        </span>
      </div>
      {doneCount === items.length && (
        <Notice kind="good" testid="plan-complete">
          {t('plan.allDone')}
        </Notice>
      )}
      <div class="plan-list" data-testid="plan-list">
        {items.map((item) => (
          <PlanRow item={item} done={isDone(item.id)} auto={auto.includes(item.id)} onToggle={() => toggle(item.id)} />
        ))}
      </div>
      <p class="help" data-testid="plan-level">
        {s.profile.skipped ? t('plan.skippedNote') : t('plan.level', { level: t(`plan.level${s.profile.level}` as Key) })}
      </p>
      <a class="btn block" href={href('home', 'test')} data-testid="test-retake">
        {t('plan.retake')}
      </a>
    </Card>
  );
}
