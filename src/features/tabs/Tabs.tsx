import { useEffect, useRef, useState } from 'preact/hooks';
import { clampBpm, MAX_BPM, MIN_BPM } from '../../audio/clock';
import { dbAll, dbDelete, dbPut, newId } from '../../db/db';
import { persistent } from '../../db/persist';
import { t } from '../../i18n';
import {
  addBar,
  EMPTY,
  emptyTab,
  isTab,
  MAX_BARS,
  MAX_FRET,
  MUTED,
  noteCount,
  removeBar,
  setNote,
  STEPS_PER_BAR,
  stringLabel,
  STRINGS,
  totalSteps,
  type Tab,
} from '../../music/tab';
import { href, navigate, route } from '../../router';
import { settings } from '../../settings';
import { Card, Segmented, Stepper, Toggle } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { BUILTIN_TABS } from './builtin';
import { tabPlayer } from './player';

interface TabsState {
  /** Çalma hızı (yüzde). */
  speed: number;
  click: boolean;
  countIn: boolean;
  loop: boolean;
  /** Yazınca imleç bir adım ilerlesin mi. */
  advance: boolean;
}

export const tabsStore = persistent<TabsState>('tabs', { speed: 100, click: true, countIn: true, loop: false, advance: true });

const SPEEDS = [50, 75, 100];
const cellText = (fret: number) => (fret === EMPTY ? '' : fret === MUTED ? 'x' : String(fret));

interface Cursor {
  step: number;
  /** Tel dizini (0 = 6. tel). */
  string: number;
}

/** Tab ızgarası: her ölçü bir blok; üstte ince Mi teli. Ölçüler ekran genişliğine göre alt alta dizilir. */
export function TabGrid(props: {
  tab: Tab;
  /** Çalınan adım (yoksa -1). */
  playing: number;
  cursor: Cursor | null;
  range?: { from: number; to: number } | null;
  onSelect?: (c: Cursor) => void;
}) {
  const { tab } = props;
  const rows = Array.from({ length: STRINGS }, (_, i) => STRINGS - 1 - i);
  return (
    <div class="tab-bars" data-testid="tab-grid" data-playing={props.playing}>
      {Array.from({ length: tab.bars }, (_, bar) => {
        const inRange = !props.range || (bar >= props.range.from && bar <= props.range.to);
        return (
          <div class={`tab-bar ${inRange ? '' : 'out'}`} data-bar={bar}>
            <span class="tab-bar-num">{bar + 1}</span>
            <div class="tab-rows">
              {rows.map((s) => (
                <div class="tab-row">
                  <span class="tab-string">{stringLabel(s)}</span>
                  {Array.from({ length: STEPS_PER_BAR }, (_, k) => {
                    const step = bar * STEPS_PER_BAR + k;
                    const fret = tab.notes[step][s];
                    const cls = [
                      'tab-cell',
                      k % 4 === 0 ? 'beat' : '',
                      step === props.playing ? 'now' : '',
                      props.cursor && props.cursor.step === step && props.cursor.string === s ? 'cursor' : '',
                      fret === EMPTY ? '' : 'note',
                    ].join(' ');
                    return (
                      <span
                        class={cls}
                        data-step={step}
                        data-string={s}
                        onClick={props.onSelect ? () => props.onSelect!({ step, string: s }) : undefined}
                      >
                        {cellText(fret)}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Keypad(props: { onFret: (n: number) => void; onPlusTen: () => void; onMute: () => void; onClear: () => void; onMove: (dx: number, dy: number) => void }) {
  return (
    <div class="keypad" data-testid="keypad">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => (
        <button type="button" class="btn key" onClick={() => props.onFret(n)} data-testid={`key-${n}`}>
          {n}
        </button>
      ))}
      <button type="button" class="btn key" onClick={props.onPlusTen} aria-label={t('tabs.plusTen')} data-testid="key-plus10">
        +10
      </button>
      <button type="button" class="btn key" onClick={props.onMute} aria-label={t('tabs.muted')} data-testid="key-x">
        x
      </button>
      <button type="button" class="btn key" onClick={props.onClear} aria-label={t('tabs.clear')} data-testid="key-clear">
        <Icon name="trash" />
      </button>
      <button type="button" class="btn key" onClick={() => props.onMove(-1, 0)} aria-label={t('tabs.left')} data-testid="key-left">
        ◀
      </button>
      <button type="button" class="btn key" onClick={() => props.onMove(1, 0)} aria-label={t('tabs.right')} data-testid="key-right">
        ▶
      </button>
      <button type="button" class="btn key" onClick={() => props.onMove(0, 1)} aria-label={t('tabs.up')} data-testid="key-up">
        ▲
      </button>
      <button type="button" class="btn key" onClick={() => props.onMove(0, -1)} aria-label={t('tabs.down')} data-testid="key-down">
        ▼
      </button>
    </div>
  );
}

function TabList({ tabs }: { tabs: Tab[] }) {
  return (
    <div class="stack">
      <a class="btn primary block big" href={href('tabs', 'new')} data-testid="tab-new">
        <Icon name="plus" /> {t('tabs.new')}
      </a>
      <div class="list" data-testid="tab-list">
        {tabs.map((tab) => (
          <a class="list-row song-row" href={href('tabs', tab.id)} data-testid="tab-row">
            <strong>{tab.name}</strong>
            <span class="dim">
              {tab.builtin ? `${t('tabs.exercise')} · ` : ''}
              {t('tabs.summary', { bars: tab.bars, bpm: tab.bpm, notes: noteCount(tab) })}
            </span>
          </a>
        ))}
      </div>
      <p class="help">{t('tabs.listHelp')}</p>
    </div>
  );
}

function TabView({ initial, isNew, onChanged }: { initial: Tab; isNew: boolean; onChanged: () => Promise<void> }) {
  const store = tabsStore.state.value;
  const [tab, setTab] = useState(initial);
  const [editing, setEditing] = useState(isNew);
  const [dirty, setDirty] = useState(isNew);
  const [cursor, setCursor] = useState<Cursor>({ step: 0, string: 0 });
  const [range, setRange] = useState({ from: 0, to: initial.bars - 1 });
  /** Son yazılan hücre: "+10" ona uygulanır. */
  const lastEdit = useRef<Cursor | null>(null);
  const running = tabPlayer.running.value;
  const pos = tabPlayer.position.value;
  const playing = running && pos && !pos.countIn ? pos.step : -1;
  const playingBar = playing >= 0 ? Math.floor(playing / STEPS_PER_BAR) : -1;

  useEffect(() => () => tabPlayer.stop(), []);

  // Çalarken geçerli ölçüyü görünür tut.
  useEffect(() => {
    if (playingBar < 0) return;
    document.querySelector(`[data-bar="${playingBar}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [playingBar]);

  // Hızlı art arda tuş basışlarında bir sonraki çizim beklenmeden doğru duruma bakılabilsin diye
  // tab ve imlecin güncel hali referanslarda da tutulur.
  const tabRef = useRef(tab);
  const cursorRef = useRef(cursor);

  const change = (next: Tab) => {
    tabRef.current = next;
    setTab(next);
    setDirty(true);
    const last = next.bars - 1;
    setRange((r) => ({ from: Math.min(r.from, last), to: Math.min(Math.max(r.to, r.from), last) }));
  };

  const placeCursor = (c: Cursor) => {
    const next = {
      step: Math.max(0, Math.min(totalSteps(tabRef.current) - 1, c.step)),
      string: Math.max(0, Math.min(STRINGS - 1, c.string)),
    };
    cursorRef.current = next;
    setCursor(next);
  };

  const move = (dx: number, dy: number) =>
    placeCursor({ step: cursorRef.current.step + dx, string: cursorRef.current.string + dy });

  const write = (fret: number) => {
    const at = cursorRef.current;
    change(setNote(tabRef.current, at.step, at.string, fret));
    lastEdit.current = at;
    if (tabsStore.state.peek().advance && fret !== EMPTY) move(1, 0);
  };

  const plusTen = () => {
    const at = lastEdit.current ?? cursorRef.current;
    const fret = tabRef.current.notes[at.step]?.[at.string];
    if (fret === undefined || fret < 0 || fret + 10 > MAX_FRET) return;
    change(setNote(tabRef.current, at.step, at.string, fret + 10));
  };

  // Masaüstünde klavye: rakamlar, oklar, x, Sil.
  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      if (/^[0-9]$/.test(e.key)) write(Number(e.key));
      else if (e.key === 'x' || e.key === 'X') write(MUTED);
      else if (e.key === 'Backspace' || e.key === 'Delete') write(EMPTY);
      else if (e.key === 'ArrowLeft') move(-1, 0);
      else if (e.key === 'ArrowRight') move(1, 0);
      else if (e.key === 'ArrowUp') move(0, 1);
      else if (e.key === 'ArrowDown') move(0, -1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  const toggle = () => {
    if (running) {
      tabPlayer.stop();
      return;
    }
    void tabPlayer.start(tab, {
      speed: store.speed / 100,
      range: { ...range, loop: store.loop },
      click: store.click,
      countIn: store.countIn,
      a4: settings.a4.peek(),
    });
  };

  const save = async () => {
    const record = { ...tab, name: tab.name.trim() || t('tabs.untitled'), builtin: undefined };
    await dbPut('items', { ...record, type: 'tab', date: Date.now() });
    await onChanged();
    setTab(record);
    setDirty(false);
    setEditing(false);
    if (isNew) navigate('tabs', record.id);
  };

  const remove = async () => {
    if (!confirm(t('tabs.deleteConfirm'))) return;
    await dbDelete('items', tab.id);
    await onChanged();
    navigate('tabs');
  };

  const copy = async () => {
    const id = newId();
    await dbPut('items', { ...tab, id, name: `${tab.name} (${t('tabs.copyTag')})`, builtin: undefined, type: 'tab', date: Date.now() });
    await onChanged();
    navigate('tabs', id);
  };

  return (
    <div class="tabs-view">
      <div class="stack">
        <Card testid="tab">
          {editing ? (
            <label class="field">
              <span class="field-label">{t('tabs.name')}</span>
              <input
                class="input"
                type="text"
                maxLength={60}
                value={tab.name}
                onInput={(e) => change({ ...tab, name: (e.target as HTMLInputElement).value })}
                data-testid="tab-name"
              />
            </label>
          ) : (
            <h2 class="song-title" data-testid="tab-title">
              {tab.name}
            </h2>
          )}
          {running && pos?.countIn && (
            <div class="tx-status" data-testid="tab-counting">
              {t('backing.counting')} · {4 - pos.step}
            </div>
          )}
          <TabGrid
            tab={tab}
            playing={playing}
            cursor={editing && !running ? cursor : null}
            range={range.from > 0 || range.to < tab.bars - 1 ? range : null}
            onSelect={editing ? placeCursor : undefined}
          />
          <button
            type="button"
            class={`btn big block ${running ? '' : 'primary'}`}
            onClick={toggle}
            aria-pressed={running}
            data-testid="tab-toggle"
          >
            <Icon name={running ? 'stop' : 'play'} /> {running ? t('backing.stop') : t('tabs.play')}
          </button>
        </Card>

        {editing && (
          <Card title={t('tabs.edit')} testid="tab-editor">
            <p class="help" data-testid="cursor-info">
              {t('tabs.cursor', {
                bar: Math.floor(cursor.step / STEPS_PER_BAR) + 1,
                step: (cursor.step % STEPS_PER_BAR) + 1,
                string: STRINGS - cursor.string,
              })}
            </p>
            <Keypad onFret={write} onPlusTen={plusTen} onMute={() => write(MUTED)} onClear={() => write(EMPTY)} onMove={move} />
            <Toggle
              label={t('tabs.advance')}
              checked={store.advance}
              onChange={(advance) => tabsStore.update({ advance })}
              testid="tab-advance"
            />
            <div class="row">
              <button
                type="button"
                class="btn grow"
                onClick={() => change(addBar(tab))}
                disabled={tab.bars >= MAX_BARS}
                data-testid="bar-add"
              >
                <Icon name="plus" /> {t('tabs.addBar')}
              </button>
              <button
                type="button"
                class="btn grow"
                onClick={() => {
                  change(removeBar(tab));
                  // İmleç silinen ölçüde kaldıysa son adıma çekilir.
                  placeCursor(cursorRef.current);
                }}
                disabled={tab.bars <= 1}
                data-testid="bar-remove"
              >
                <Icon name="minus" /> {t('tabs.removeBar')}
              </button>
            </div>
            <p class="help">{t('tabs.editHelp')}</p>
          </Card>
        )}
      </div>

      <div class="stack">
        <Card title={t('tabs.playback')} testid="tab-playback">
          <div class="field">
            <span class="field-label">{t('tabs.speed')}</span>
            <Segmented
              label={t('tabs.speed')}
              options={SPEEDS.map((n) => ({ value: n, label: `%${n}` }))}
              value={store.speed}
              onChange={(speed) => {
                tabsStore.update({ speed });
                tabPlayer.setSpeed(speed / 100);
              }}
              testid="tab-speed"
            />
          </div>
          <div class="field">
            <span class="field-label">{t('backing.tempo')}</span>
            <Stepper
              label={t('backing.tempo')}
              value={tab.bpm}
              min={MIN_BPM}
              max={MAX_BPM}
              step={5}
              onChange={(bpm) => change({ ...tab, bpm: clampBpm(bpm) })}
              format={(v) => `${v} BPM`}
              testid="tab-bpm"
            />
          </div>
          <div class="field">
            <span class="field-label">{t('tabs.range')}</span>
            <div class="row">
              <div class="grow">
                <Stepper
                  label={t('tabs.from')}
                  value={range.from + 1}
                  min={1}
                  max={range.to + 1}
                  onChange={(v) => setRange({ ...range, from: v - 1 })}
                  format={(v) => t('tabs.barN', { n: v })}
                  testid="range-from"
                />
              </div>
            </div>
            <div class="row">
              <div class="grow">
                <Stepper
                  label={t('tabs.to')}
                  value={range.to + 1}
                  min={range.from + 1}
                  max={tab.bars}
                  onChange={(v) => setRange({ ...range, to: v - 1 })}
                  format={(v) => t('tabs.barToN', { n: v })}
                  testid="range-to"
                />
              </div>
            </div>
          </div>
          <Toggle label={t('tabs.loop')} checked={store.loop} onChange={(loop) => tabsStore.update({ loop })} testid="tab-loop" />
          <Toggle label={t('tabs.click')} checked={store.click} onChange={(click) => tabsStore.update({ click })} testid="tab-click" />
          <Toggle
            label={t('backing.countInToggle')}
            checked={store.countIn}
            onChange={(countIn) => tabsStore.update({ countIn })}
            testid="tab-countin"
          />
        </Card>

        <div class="row">
          {tab.builtin ? (
            <button type="button" class="btn grow" onClick={copy} data-testid="tab-copy">
              <Icon name="edit" /> {t('songs.copy')}
            </button>
          ) : editing ? (
            <>
              <button type="button" class="btn primary grow" onClick={save} data-testid="tab-save">
                <Icon name="check" /> {t('common.save')}
              </button>
              {!isNew && (
                <button type="button" class="btn danger" aria-label={t('common.delete')} onClick={remove} data-testid="tab-delete">
                  <Icon name="trash" />
                </button>
              )}
            </>
          ) : (
            <button type="button" class="btn grow" onClick={() => setEditing(true)} data-testid="tab-edit">
              <Icon name="edit" /> {t('songs.edit')}
            </button>
          )}
          <a class="btn grow" href={href('tabs')} data-testid="tab-back">
            <Icon name="back" /> {t('tabs.all')}
          </a>
        </div>
        {dirty && !tab.builtin && !editing && (
          <button type="button" class="btn primary block" onClick={save} data-testid="tab-save-changes">
            {t('tabs.saveChanges')}
          </button>
        )}
      </div>
    </div>
  );
}

export function TabsScreen() {
  const [custom, setCustom] = useState<Tab[] | null>(null);
  const [id] = route.value.rest;
  const draft = useRef<Tab | null>(null);

  const load = () => dbAll('items', 'tab').then((rows) => setCustom((rows as unknown[]).filter(isTab)));
  useEffect(() => {
    void load();
  }, []);

  if (custom === null) return null;
  const all = [...BUILTIN_TABS, ...custom];

  if (id === 'new') {
    draft.current ??= emptyTab(newId(), t('tabs.defaultName'), 2, 90);
    return <TabView key={draft.current.id} initial={draft.current} isNew onChanged={load} />;
  }
  draft.current = null;
  const tab = id ? all.find((x) => x.id === id) : undefined;
  if (!tab) return <TabList tabs={all} />;
  return <TabView key={tab.id} initial={tab} isNew={false} onChanged={load} />;
}
