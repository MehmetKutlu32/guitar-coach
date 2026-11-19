import { effect } from '@preact/signals';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { clampBpm, MAX_BPM, MIN_BPM } from '../../audio/clock';
import { dbAll, dbDelete, dbGet, dbPut, newId } from '../../db/db';
import { persistent } from '../../db/persist';
import { t, type Key } from '../../i18n';
import {
  buildTimeline,
  chordEvents,
  eventAt,
  parseChordPro,
  shownChord,
  soundingChord,
  uniqueChords,
  type Song,
} from '../../music/chordpro';
import { primaryShape } from '../../music/chords';
import { isChordPlayed, RECOGNIZED_QUALITIES } from '../../music/recognize';
import { chordSymbol, parseChord } from '../../music/theory';
import { href, navigate, route } from '../../router';
import { ChordDiagram } from '../../ui/ChordDiagram';
import { Card, Notice, Segmented, Stepper, Toggle } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { backingStore } from '../backing/Backing';
import { backing } from '../backing/player';
import { STYLE_IDS, STYLES, type StyleId } from '../backing/styles';
import { playShape } from '../chords/Chords';
import { heardChord, listenForChords } from '../chords/listener';
import { BUILTIN_SONGS, isSongRecord, NEW_SONG_TEXT, type SongRecord } from './builtin';

interface SongSettings {
  bpm: number;
  transpose: number;
  capo: number;
  beatsPerChord: number;
  style: StyleId;
}

interface SongsState {
  /** Şarkı başına ayarlar (hazır şarkılar dahil). */
  settings: Record<string, SongSettings>;
  fontSize: number;
  /** Çalarken grup (davul, bas, akor) duyulsun mu; kapalıyken yalnızca metronom tıkı. */
  band: boolean;
  /** Çalarken akorlar mikrofonla denetlensin mi. */
  listen: boolean;
}

export const songsStore = persistent<SongsState>('songs', { settings: {}, fontSize: 18, band: true, listen: false });

function settingsFor(record: SongRecord, song: Song): SongSettings {
  return (
    songsStore.state.value.settings[record.id] ?? {
      bpm: song.tempo ?? record.bpm,
      transpose: record.transpose,
      capo: song.capo ?? record.capo,
      beatsPerChord: record.beatsPerChord,
      style: record.style,
    }
  );
}

function updateSettings(id: string, current: SongSettings, patch: Partial<SongSettings>): void {
  songsStore.update({ settings: { ...songsStore.state.peek().settings, [id]: { ...current, ...patch } } });
}

/** Şarkıyı verilen tempoyla açar (günlük plan). Şarkının öbür ayarları (transpoze, kapo…) korunur. */
export async function openSongAt(id: string, bpm: number): Promise<void> {
  const record: unknown = BUILTIN_SONGS.find((s) => s.id === id) ?? (await dbGet('items', id));
  if (isSongRecord(record)) updateSettings(id, settingsFor(record, parseChordPro(record.text)), { bpm: clampBpm(bpm) });
  navigate('songs', id);
}

const titleOf = (song: Song) => song.title.trim() || t('songs.untitled');

/** Sözler ve üstlerinde akorlar. `current` çalınan akorun, `hits` doğru basılan akorların sırasıdır. */
export function Lyrics(props: {
  song: Song;
  transpose: number;
  capo: number;
  fontSize: number;
  current?: number;
  hits?: Set<number>;
}) {
  const { song } = props;
  let index = -1;
  return (
    <div class="lyrics" style={{ fontSize: `${props.fontSize}px` }} data-testid="lyrics">
      {song.lines.map((line, li) => {
        if (line.type === 'empty') return <div class="ly-gap" />;
        if (line.type === 'comment') return <p class="ly-comment">{line.text}</p>;
        if (line.type === 'section') {
          return <p class="ly-section">{line.label || t(`songs.section.${line.kind}` as Key)}</p>;
        }
        return (
          <div class={`ly-line ${line.section === 'chorus' ? 'chorus' : ''}`} data-line={li}>
            {line.segments.map((seg) => {
              const i = seg.chord ? ++index : -1;
              const cls = i < 0 ? '' : i === props.current ? 'now' : props.hits?.has(i) ? 'hit' : '';
              return (
                <span class="ly-seg">
                  <span class={`ly-chord ${cls}`} data-ev={i >= 0 ? i : undefined}>
                    {seg.chord ? shownChord(seg.chord, props.transpose, props.capo) : ' '}
                  </span>
                  <span class="ly-text">{seg.text || ' '}</span>
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function SongList({ songs }: { songs: SongRecord[] }) {
  return (
    <div class="stack">
      <a class="btn primary block big" href={href('songs', 'new')} data-testid="song-new">
        <Icon name="plus" /> {t('songs.new')}
      </a>
      <div class="list" data-testid="song-list">
        {songs.map((record) => {
          const song = parseChordPro(record.text);
          return (
            <a class="list-row song-row" href={href('songs', record.id)} data-testid="song-row">
              <strong>{titleOf(song)}</strong>
              <span class="dim">
                {song.artist || (record.builtin ? t('songs.exercise') : '')}
                {' · '}
                {uniqueChords(song, 0, 0).slice(0, 6).join(' ')}
              </span>
            </a>
          );
        })}
      </div>
      <p class="help">{t('songs.listHelp')}</p>
    </div>
  );
}

function SongEditor(props: { record: SongRecord; isNew: boolean; onSaved: () => Promise<void> }) {
  const [text, setText] = useState(props.record.text);
  const song = parseChordPro(text);
  const unknown = chordEvents(song)
    .filter((e) => !e.playable)
    .map((e) => e.written);

  const save = async () => {
    await dbPut('items', {
      id: props.record.id,
      type: 'song',
      date: Date.now(),
      text,
      bpm: song.tempo ?? props.record.bpm,
      transpose: 0,
      capo: song.capo ?? 0,
      beatsPerChord: props.record.beatsPerChord,
      style: props.record.style,
    });
    await props.onSaved();
    navigate('songs', props.record.id);
  };

  const remove = async () => {
    if (!confirm(t('songs.deleteConfirm'))) return;
    await dbDelete('items', props.record.id);
    await props.onSaved();
    navigate('songs');
  };

  return (
    <div class="songs-edit">
      <Card title={t('songs.editor')} testid="song-editor">
        <textarea
          class="input textarea song-text"
          rows={14}
          spellcheck={false}
          autocapitalize="off"
          aria-label={t('songs.editor')}
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          data-testid="song-text"
        />
        <p class="help">{t('songs.editorHelp')}</p>
        {unknown.length > 0 && (
          <Notice kind="error" testid="song-unknown">
            {t('backing.unknown', { list: [...new Set(unknown)].join(', ') })}
          </Notice>
        )}
        <div class="row">
          <button type="button" class="btn primary grow" onClick={save} disabled={text.trim() === ''} data-testid="song-save">
            {t('common.save')}
          </button>
          <a class="btn grow" href={props.isNew ? href('songs') : href('songs', props.record.id)}>
            {t('common.cancel')}
          </a>
          {!props.isNew && (
            <button type="button" class="btn danger" aria-label={t('common.delete')} onClick={remove} data-testid="song-delete">
              <Icon name="trash" />
            </button>
          )}
        </div>
      </Card>
      <Card title={t('songs.preview')}>
        <h2 class="song-title">{titleOf(song)}</h2>
        <Lyrics song={song} transpose={0} capo={0} fontSize={16} />
      </Card>
    </div>
  );
}

function SongView({ record, onCopy }: { record: SongRecord; onCopy: () => Promise<void> }) {
  const store = songsStore.state.value;
  const song = useMemo(() => parseChordPro(record.text), [record.text]);
  const st = settingsFor(record, song);
  const events = useMemo(() => chordEvents(song), [song]);
  const timeline = useMemo(() => buildTimeline(song, st.transpose, st.beatsPerChord), [song, st.transpose, st.beatsPerChord]);
  const running = backing.running.value;
  const pos = backing.position.value;
  const current = running && pos && !pos.countIn ? eventAt(timeline, pos.bar, pos.beat) : -1;
  const currentLine = current >= 0 ? events[current].line : -1;
  const [hits, setHits] = useState<Set<number>>(new Set());
  const [reached, setReached] = useState(0);
  const listening = useRef<(() => void) | null>(null);
  const currentRef = useRef(-1);
  currentRef.current = current;
  const set = (patch: Partial<SongSettings>) => updateSettings(record.id, st, patch);

  const stopListening = () => {
    listening.current?.();
    listening.current = null;
  };

  useEffect(
    () => () => {
      backing.stop();
      listening.current?.();
      listening.current = null;
    },
    [],
  );

  // Çalarken geçerli satırı ekranın ortasında tut (tempoya göre otomatik kaydırma).
  useEffect(() => {
    if (currentLine < 0) return;
    document.querySelector(`[data-line="${currentLine}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [currentLine]);

  useEffect(() => {
    if (current >= 0) setReached((r) => Math.max(r, timeline.steps.indexOf(current) + 1));
  }, [current]);

  // Çalma bitince (dizi sonu ya da durdurma) dinlemeyi kapat.
  useEffect(() => {
    if (!running) stopListening();
  }, [running]);

  const start = async () => {
    setHits(new Set());
    setReached(0);
    if (store.listen) {
      try {
        const release = await listenForChords();
        const off = effect(() => {
          const h = heardChord.value;
          const i = currentRef.current;
          if (i < 0 || !h.sounding || h.chroma.length !== 12) return;
          const p = parseChord(soundingChord(events[i].written, st.transpose));
          if (!p || !RECOGNIZED_QUALITIES.includes(p.quality)) return;
          if (isChordPlayed(h.chroma, h.bass, { root: p.root, quality: p.quality, symbol: chordSymbol(p.root, p.quality) })) {
            setHits((prev) => (prev.has(i) ? prev : new Set(prev).add(i)));
          }
        });
        listening.current = () => {
          off();
          release();
        };
      } catch {
        return;
      }
    }
    const bs = backingStore.state.peek();
    await backing.start({
      bars: timeline.bars,
      bpm: st.bpm,
      style: st.style,
      loop: false,
      countIn: true,
      click: !store.band,
      levels: store.band
        ? { drums: bs.drums / 100, bass: bs.bass / 100, chords: bs.chords / 100 }
        : { drums: 0, bass: 0, chords: 0 },
    });
  };

  const stop = () => {
    backing.stop();
    stopListening();
  };

  const shapes = uniqueChords(song, st.transpose, st.capo)
    .map((sym) => primaryShape(sym))
    .filter((s): s is NonNullable<typeof s> => !!s);
  const canPlay = timeline.bars.length > 0;
  const showScore = store.listen && !running && reached > 0;

  return (
    <div class="songs-view">
      <div class="stack">
        <Card testid="song">
          <div class="song-head">
            <div>
              <h2 class="song-title" data-testid="song-title">
                {titleOf(song)}
              </h2>
              {song.artist && <p class="dim">{song.artist}</p>}
            </div>
            <div class="row">
              <button
                type="button"
                class="btn icon-only"
                aria-label={t('songs.fontSmaller')}
                onClick={() => songsStore.update({ fontSize: Math.max(13, store.fontSize - 2) })}
                data-testid="font-smaller"
              >
                A−
              </button>
              <button
                type="button"
                class="btn icon-only"
                aria-label={t('songs.fontLarger')}
                onClick={() => songsStore.update({ fontSize: Math.min(28, store.fontSize + 2) })}
                data-testid="font-larger"
              >
                A+
              </button>
            </div>
          </div>
          {running && pos?.countIn && (
            <div class="tx-status" data-testid="song-counting">
              {t('backing.counting')} · {4 - pos.beat}
            </div>
          )}
          {showScore && (
            <Notice kind="good" testid="song-score">
              {t('songs.score', { hit: hits.size, total: reached })}
            </Notice>
          )}
          <Lyrics song={song} transpose={st.transpose} capo={st.capo} fontSize={store.fontSize} current={current} hits={hits} />
          <button
            type="button"
            class={`btn big block song-play ${running ? '' : 'primary'}`}
            onClick={running ? stop : start}
            disabled={!canPlay}
            aria-pressed={running}
            data-testid="song-toggle"
          >
            <Icon name={running ? 'stop' : 'play'} /> {running ? t('backing.stop') : t('songs.play')}
          </button>
        </Card>
      </div>

      <div class="stack">
        <Card title={t('songs.settings')} testid="song-settings">
          <div class="field">
            <span class="field-label">{t('songs.transpose')}</span>
            <Stepper
              label={t('songs.transpose')}
              value={st.transpose}
              min={-11}
              max={11}
              onChange={(transpose) => set({ transpose })}
              format={(v) => (v > 0 ? `+${v}` : String(v))}
              testid="song-transpose"
            />
          </div>
          <div class="field">
            <span class="field-label">{t('songs.capo')}</span>
            <Stepper
              label={t('songs.capo')}
              value={st.capo}
              min={0}
              max={9}
              onChange={(capo) => set({ capo })}
              format={(v) => (v === 0 ? t('songs.capoNone') : t('songs.capoFret', { n: v }))}
              testid="song-capo"
            />
            {st.capo > 0 && <p class="help" data-testid="capo-help">{t('songs.capoHelp', { n: st.capo })}</p>}
          </div>
          <div class="field">
            <span class="field-label">{t('backing.tempo')}</span>
            <Stepper
              label={t('backing.tempo')}
              value={st.bpm}
              min={MIN_BPM}
              max={MAX_BPM}
              step={5}
              onChange={(bpm) => set({ bpm: clampBpm(bpm) })}
              format={(v) => `${v} BPM`}
              testid="song-bpm"
            />
          </div>
          <div class="field">
            <span class="field-label">{t('songs.beatsPerChord')}</span>
            <Segmented
              label={t('songs.beatsPerChord')}
              options={[1, 2, 4, 8].map((n) => ({ value: n, label: String(n) }))}
              value={st.beatsPerChord}
              onChange={(beatsPerChord) => set({ beatsPerChord })}
              testid="song-beats"
            />
            <p class="help">{t('songs.beatsHelp')}</p>
          </div>
          <div class="field">
            <span class="field-label">{t('backing.style')}</span>
            <Segmented
              label={t('backing.style')}
              options={STYLE_IDS.map((id) => ({ value: id, label: t(STYLES[id].name) }))}
              value={st.style}
              onChange={(style) => set({ style })}
              testid="song-style"
            />
          </div>
          <Toggle label={t('songs.band')} checked={store.band} onChange={(band) => songsStore.update({ band })} testid="song-band" />
          <Toggle
            label={t('songs.listen')}
            checked={store.listen}
            onChange={(listen) => songsStore.update({ listen })}
            testid="song-listen"
          />
          {store.listen && <p class="help">{t('songs.listenHelp')}</p>}
        </Card>

        {shapes.length > 0 && (
          <Card title={t('songs.chords')} testid="song-chords">
            <div class="song-shapes">
              {shapes.map((shape) => (
                <button
                  type="button"
                  class="pair-chord"
                  aria-label={t('chords.play', { name: shape.symbol })}
                  onClick={() => void playShape(shape)}
                >
                  <strong class="chord-name small">{shape.symbol}</strong>
                  <ChordDiagram shape={shape} />
                </button>
              ))}
            </div>
          </Card>
        )}

        <div class="row">
          {record.builtin ? (
            <button type="button" class="btn grow" onClick={onCopy} data-testid="song-copy">
              <Icon name="edit" /> {t('songs.copy')}
            </button>
          ) : (
            <a class="btn grow" href={href('songs', record.id, 'edit')} data-testid="song-edit">
              <Icon name="edit" /> {t('songs.edit')}
            </a>
          )}
          <a class="btn grow" href={href('songs')} data-testid="song-back">
            <Icon name="back" /> {t('songs.all')}
          </a>
        </div>
      </div>
    </div>
  );
}

export function SongsScreen() {
  const [custom, setCustom] = useState<SongRecord[] | null>(null);
  const [id, mode] = route.value.rest;

  const load = () => dbAll('items', 'song').then((rows) => setCustom((rows as unknown[]).filter(isSongRecord)));
  useEffect(() => {
    void load();
  }, []);

  if (custom === null) return null;
  const all = [...BUILTIN_SONGS, ...custom];

  if (id === 'new') {
    const draft: SongRecord = { id: newId(), text: NEW_SONG_TEXT, bpm: 90, transpose: 0, capo: 0, beatsPerChord: 4, style: 'pop' };
    return <SongEditor key="new" record={draft} isNew onSaved={load} />;
  }
  const record = id ? all.find((s) => s.id === id) : undefined;
  if (!record) return <SongList songs={all} />;
  if (mode === 'edit' && !record.builtin) return <SongEditor key={record.id} record={record} isNew={false} onSaved={load} />;

  const copy = async () => {
    const copyId = newId();
    await dbPut('items', { ...record, id: copyId, builtin: undefined, type: 'song', date: Date.now() });
    await load();
    navigate('songs', copyId, 'edit');
  };
  return <SongView key={record.id} record={record} onCopy={copy} />;
}
