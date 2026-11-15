import { useEffect, useRef, useState } from 'preact/hooks';
import { inputStatus, onAnalysis } from '../../audio/input';
import { recordingSupported, startRecording, type ActiveRecording } from '../../audio/recorder';
import { dbAll, dbDelete, dbPut, newId } from '../../db/db';
import { t, type Key } from '../../i18n';
import { settings } from '../../settings';
import { Card, LevelMeter, Notice, Segmented } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { Waveform } from '../../ui/Waveform';
import { cacheBuffer, decodeAudio, forgetBuffer, playPosition, playState, playTakes, setActiveTake, stopTakes } from './player';
import {
  CLIP_LEVEL,
  computePeaks,
  cursorFraction,
  formatBytes,
  formatDuration,
  isTake,
  MAX_SECONDS,
  maxLevel,
  mixToMono,
  nextTakeNumber,
  quantizePeaks,
  seekSeconds,
  toBase64,
  totalBytes,
  type Take,
  type TakeAudio,
} from './takes';

type Phase = 'idle' | 'starting' | 'recording' | 'saving';
type Warning = 'tooShort' | 'silent' | 'clipped' | 'failed' | 'unsupported' | 'decode';

/** Bundan kısa kayıtlar yanlışlıkla basılmış sayılır ve saklanmaz. */
const MIN_SECONDS = 0.4;
/** Tepe seviyesi bunun altındaysa kayıtta ses yok sayılır. */
const SILENT_LEVEL = 0.01;
/** Kayıt sırasında gösterilen canlı iz: son kaç çerçeve. */
const LIVE_BARS = 80;

export function RecorderScreen() {
  const lang = settings.lang.value;
  const status = inputStatus.value;
  const playing = playState.value;
  const [takes, setTakes] = useState<Take[] | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [warning, setWarning] = useState<Warning | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState('');
  const [ab, setAb] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const active = useRef<ActiveRecording | null>(null);
  const startedAt = useRef(0);
  const liveRef = useRef<number[]>([]);
  const stopRef = useRef<() => void>(() => undefined);

  const load = async (): Promise<Take[]> => {
    const rows = ((await dbAll('items', 'recording')) as unknown[]).filter(isTake).sort((a, b) => b.date - a.date);
    setTakes(rows);
    return rows;
  };

  useEffect(() => {
    void load();
    return () => {
      active.current?.cancel();
      active.current = null;
      stopTakes();
    };
  }, []);

  // Kayıt sırasında süre sayacı ve canlı seviye izi.
  useEffect(() => {
    if (phase !== 'recording') return;
    const off = onAnalysis((frame) => {
      liveRef.current = [...liveRef.current.slice(-(LIVE_BARS - 1)), Math.min(100, Math.round(frame.peak * 100))];
    });
    const timer = setInterval(() => {
      const s = (performance.now() - startedAt.current) / 1000;
      setElapsed(s);
      setLive(liveRef.current);
      if (s >= MAX_SECONDS) stopRef.current();
    }, 150);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [phase]);

  // Çalarken imleci ilerlet.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      setCursor(playPosition());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing?.startedAt]);

  const start = async () => {
    setWarning(null);
    if (!recordingSupported()) {
      setWarning('unsupported');
      return;
    }
    stopTakes();
    setPhase('starting');
    try {
      active.current = await startRecording();
    } catch {
      // Giriş hatası `inputStatus` üzerinden gösterilir.
      setPhase('idle');
      return;
    }
    startedAt.current = performance.now();
    liveRef.current = [];
    setLive([]);
    setElapsed(0);
    setPhase('recording');
  };

  const stop = async () => {
    const rec = active.current;
    if (!rec) return;
    active.current = null;
    setPhase('saving');
    try {
      const { blob, mime } = await rec.stop();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const buffer = await decodeAudio(bytes);
      if (buffer.duration < MIN_SECONDS) {
        setWarning('tooShort');
        return;
      }
      const mono = mixToMono(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)));
      const peak = maxLevel(mono);
      const prefix = t('rec.takeName');
      const take: Take = {
        id: newId(),
        type: 'recording',
        date: Date.now(),
        name: `${prefix} ${nextTakeNumber(takes ?? [], prefix)}`,
        seconds: buffer.duration,
        peaks: quantizePeaks(computePeaks(mono)),
        peak,
        mime,
        bytes: bytes.length,
      };
      const audio: TakeAudio = { id: take.id, type: 'recording', date: take.date, mime, base64: toBase64(bytes) };
      await dbPut('blobs', audio);
      await dbPut('items', take);
      cacheBuffer(take.id, buffer);
      await load();
      setSelectedId(take.id);
      setCompareId('');
      setAb(0);
      setCursor(0);
      setWarning(peak < SILENT_LEVEL ? 'silent' : peak >= CLIP_LEVEL ? 'clipped' : null);
    } catch (err) {
      console.error('[recorder]', err);
      setWarning('failed');
    } finally {
      setPhase('idle');
    }
  };
  stopRef.current = () => void stop();

  const cancel = () => {
    active.current?.cancel();
    active.current = null;
    setPhase('idle');
  };

  const selected = takes?.find((x) => x.id === selectedId) ?? null;
  const other = takes?.find((x) => x.id === compareId && x.id !== selectedId) ?? null;
  const total = Math.max(selected?.seconds ?? 0, other?.seconds ?? 0);
  const isPlaying = !!playing && !!selected && playing.ids[0] === selected.id;
  const position = isPlaying ? cursor : Math.min(cursor, total);

  const play = async (offset: number, activeIndex = ab) => {
    if (!selected) return;
    const ids = other ? [selected.id, other.id] : [selected.id];
    try {
      await playTakes(ids, offset, other ? activeIndex : 0);
    } catch (err) {
      console.error('[recorder] play', err);
      setWarning('decode');
    }
  };

  const select = (id: string) => {
    stopTakes();
    setSelectedId(id === selectedId ? null : id);
    setCompareId('');
    setAb(0);
    setCursor(0);
    setRenaming(null);
    setWarning(null);
  };

  const seek = (fraction: number, seconds: number) => {
    const to = seekSeconds(fraction, seconds);
    setCursor(to);
    if (isPlaying) void play(to);
  };

  const switchAb = (index: number) => {
    setAb(index);
    if (isPlaying) setActiveTake(index);
  };

  const saveName = async () => {
    if (!selected || renaming === null) return;
    const name = renaming.trim();
    if (name) {
      await dbPut('items', { ...selected, name });
      await load();
    }
    setRenaming(null);
  };

  const remove = async () => {
    if (!selected || !confirm(t('rec.deleteConfirm'))) return;
    stopTakes();
    await dbDelete('items', selected.id);
    await dbDelete('blobs', selected.id);
    forgetBuffer(selected.id);
    setSelectedId(null);
    setCompareId('');
    await load();
  };

  const fmtDate = (d: number) =>
    new Date(d).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const busy = phase !== 'idle';

  return (
    <div class="stack">
      <Card title={t('rec.new')} testid="rec-new">
        {status === 'denied' && <Notice kind="error" testid="input-error">{t('input.denied')}</Notice>}
        {status === 'unavailable' && <Notice kind="error" testid="input-error">{t('input.unavailable')}</Notice>}
        {status === 'error' && <Notice kind="error" testid="input-error">{t('input.error')}</Notice>}
        {warning && (
          <Notice kind={warning === 'silent' || warning === 'clipped' || warning === 'tooShort' ? 'info' : 'error'} testid="rec-warning">
            {t(`rec.warn.${warning}` as Key)}
          </Notice>
        )}
        {phase === 'recording' || phase === 'saving' ? (
          <>
            <div class="rec-clock" data-testid="rec-clock" data-phase={phase}>
              <span class="rec-dot" aria-hidden="true" />
              {phase === 'saving' ? t('rec.saving') : formatDuration(elapsed)}
            </div>
            <Waveform peaks={live.length ? live : [0]} title={t('rec.live')} testid="rec-live" uid="live" height={48} />
            <LevelMeter />
            <button type="button" class="btn primary block big" onClick={() => void stop()} disabled={phase === 'saving'} data-testid="rec-stop">
              <Icon name="stop" /> {t('rec.stop')}
            </button>
            <button type="button" class="btn block" onClick={cancel} disabled={phase === 'saving'} data-testid="rec-cancel">
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <>
            <button type="button" class="btn primary block big" onClick={() => void start()} disabled={busy} data-testid="rec-start">
              <Icon name="record" /> {t('rec.start')}
            </button>
            <p class="help">{t('rec.hint', { min: MAX_SECONDS / 60 })}</p>
          </>
        )}
      </Card>

      {selected && (
        <Card testid="rec-detail">
          {renaming === null ? (
            <div class="rec-head">
              <div class="rec-title">
                <strong data-testid="rec-name" data-id={selected.id}>{selected.name}</strong>
                <span class="help" data-testid="rec-meta">
                  {fmtDate(selected.date)} · {formatDuration(selected.seconds)} · {formatBytes(selected.bytes, lang === 'tr' ? ',' : '.')}
                </span>
              </div>
              <button type="button" class="btn icon-only" aria-label={t('rec.rename')} onClick={() => setRenaming(selected.name)} data-testid="rec-rename">
                <Icon name="edit" />
              </button>
            </div>
          ) : (
            <div class="row">
              <input
                class="input grow"
                value={renaming}
                maxLength={60}
                aria-label={t('rec.name')}
                onInput={(e) => setRenaming((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveName();
                }}
                data-testid="rec-name-input"
              />
              <button type="button" class="btn primary" onClick={() => void saveName()} data-testid="rec-name-save">
                {t('common.save')}
              </button>
            </div>
          )}

          {other && <span class="field-label">A · {selected.name}</span>}
          <Waveform
            peaks={selected.peaks}
            cursor={cursorFraction(position, selected.seconds)}
            onSeek={(f) => seek(f, selected.seconds)}
            title={t('rec.waveform', { name: selected.name })}
            testid="rec-wave-a"
            uid="a"
            height={72}
          />
          {other && (
            <>
              <span class="field-label">B · {other.name}</span>
              <Waveform
                peaks={other.peaks}
                cursor={cursorFraction(position, other.seconds)}
                onSeek={(f) => seek(f, other.seconds)}
                title={t('rec.waveform', { name: other.name })}
                testid="rec-wave-b"
                uid="b"
                height={72}
              />
              <Segmented
                label={t('rec.listenTo')}
                options={[
                  { value: 0, label: 'A' },
                  { value: 1, label: 'B' },
                ]}
                value={ab}
                onChange={switchAb}
                testid="rec-ab"
              />
            </>
          )}
          <div class="rec-time" data-testid="rec-time">
            {formatDuration(position)} / {formatDuration(total)}
          </div>
          <div class="row">
            {isPlaying ? (
              <button type="button" class="btn primary big grow" onClick={() => stopTakes()} data-testid="rec-play" data-playing="true">
                <Icon name="stop" /> {t('common.stop')}
              </button>
            ) : (
              <button
                type="button"
                class="btn primary big grow"
                onClick={() => void play(position >= total - 0.05 ? 0 : position)}
                disabled={busy}
                data-testid="rec-play"
                data-playing="false"
              >
                <Icon name="play" /> {t('rec.play')}
              </button>
            )}
            <button type="button" class="btn big danger" aria-label={t('common.delete')} onClick={() => void remove()} data-testid="rec-delete">
              <Icon name="trash" />
            </button>
          </div>
          {(takes?.length ?? 0) > 1 && (
            <div class="field">
              <span class="field-label">{t('rec.compare')}</span>
              <select
                class="select"
                aria-label={t('rec.compare')}
                value={other ? other.id : ''}
                onChange={(e) => {
                  stopTakes();
                  setCompareId((e.target as HTMLSelectElement).value);
                  setAb(0);
                  setCursor(0);
                }}
                data-testid="rec-compare"
              >
                <option value="">{t('rec.compareNone')}</option>
                {takes!
                  .filter((x) => x.id !== selected.id)
                  .map((x) => (
                    <option value={x.id}>
                      {x.name} · {fmtDate(x.date)} · {formatDuration(x.seconds)}
                    </option>
                  ))}
              </select>
              <p class="help">{t(other ? 'rec.compareHelp' : 'rec.seekHint')}</p>
            </div>
          )}
        </Card>
      )}

      <Card title={t('rec.list')} testid="rec-list">
        {takes && takes.length === 0 && <p class="help" data-testid="rec-empty">{t('rec.empty')}</p>}
        {takes && takes.length > 0 && (
          <>
            <div class="take-list">
              {takes.map((x) => (
                <button
                  type="button"
                  class={`take ${x.id === selectedId ? 'active' : ''}`}
                  aria-pressed={x.id === selectedId}
                  onClick={() => select(x.id)}
                  data-testid="rec-take"
                >
                  <span class="take-text">
                    <strong>{x.name}</strong>
                    <small>
                      {fmtDate(x.date)} · {formatDuration(x.seconds)}
                    </small>
                  </span>
                  <Waveform peaks={x.peaks} title={t('rec.waveform', { name: x.name })} uid={`l-${x.id}`} height={36} />
                </button>
              ))}
            </div>
            <p class="help" data-testid="rec-total">
              {t('rec.total', { n: takes.length, size: formatBytes(totalBytes(takes), lang === 'tr' ? ',' : '.') })}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
