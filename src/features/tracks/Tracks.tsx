import { useEffect, useRef, useState } from 'preact/hooks';
import { dbAll, dbDelete, dbGet, dbPut, newId } from '../../db/db';
import { t, type Key } from '../../i18n';
import { settings } from '../../settings';
import { Card, Notice, Stepper } from '../../ui/controls';
import { Icon } from '../../ui/Icon';
import { Waveform } from '../../ui/Waveform';
import { decodeAudio } from '../recorder/player';
import { computePeaks, formatBytes, formatDuration, fromBase64, mixToMono, quantizePeaks, toBase64, totalBytes } from '../recorder/takes';
import { loadTrackSamples, pauseTrack, playTrack, seekTrack, setTrackLoop, setTrackParams, trackPlayback, unloadTrack } from './engine';
import {
  checkLength,
  checkSize,
  clampShift,
  clampSpeed,
  formatClock,
  isTrack,
  isTrackAudio,
  loopActive,
  MAX_FILE_BYTES,
  MAX_SHIFT,
  MAX_SPEED_PERCENT,
  MAX_TRACK_SECONDS,
  MIN_SPEED_PERCENT,
  setLoopEnd,
  setLoopStart,
  shiftLabel,
  skipTo,
  SPEED_STEP,
  TRACK_PEAKS,
  trackName,
  type Loop,
  type Track,
  type TrackAudio,
} from './logic';

type Problem = 'decode' | 'tooBig' | 'tooLong' | 'store' | 'missing';

const SPEED_PRESETS = [50, 75, 100];

export function TracksScreen() {
  const lang = settings.lang.value;
  const playback = trackPlayback.value;
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [current, setCurrent] = useState<Track | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** Art arda yüklemelerde yalnızca sonuncusu geçerli olsun. */
  const loadSeq = useRef(0);

  const refresh = async (): Promise<Track[]> => {
    const rows = ((await dbAll('items', 'track')) as unknown[]).filter(isTrack).sort((a, b) => b.date - a.date);
    setTracks(rows);
    return rows;
  };

  useEffect(() => {
    void refresh();
    return () => unloadTrack();
  }, []);

  /** Çözülmüş sesi oynatıcıya yükler ve parçanın kayıtlı ayarlarını uygular. */
  const open = async (track: Track, buffer: AudioBuffer, seq: number) => {
    const mono = mixToMono(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)));
    await loadTrackSamples(mono);
    if (seq !== loadSeq.current) return;
    setTrackParams(track.speed, track.semitones);
    setTrackLoop(track.loopA, track.loopB);
    if (loopActive({ a: track.loopA, b: track.loopB })) seekTrack(track.loopA!);
    setCurrent(track);
  };

  const onFile = async (file: File) => {
    const seq = ++loadSeq.current;
    setProblem(null);
    if (checkSize(file.size)) {
      setProblem('tooBig');
      return;
    }
    pauseTrack();
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let buffer: AudioBuffer;
      try {
        buffer = await decodeAudio(bytes);
      } catch {
        setProblem('decode');
        return;
      }
      if (checkLength(buffer.duration)) {
        setProblem('tooLong');
        return;
      }
      const mono = mixToMono(Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c)));
      const track: Track = {
        id: newId(),
        type: 'track',
        date: Date.now(),
        name: trackName(file.name),
        seconds: buffer.duration,
        peaks: quantizePeaks(computePeaks(mono, TRACK_PEAKS)),
        mime: file.type || 'audio/*',
        bytes: bytes.length,
        speed: 100,
        semitones: 0,
        loopA: null,
        loopB: null,
      };
      try {
        const audio: TrackAudio = { id: track.id, type: 'track', date: track.date, mime: track.mime, base64: toBase64(bytes) };
        await dbPut('blobs', audio);
        await dbPut('items', track);
        await refresh();
      } catch (err) {
        // Depolama dolu olabilir: parça bu oturumda yine de çalınabilir.
        console.error('[tracks] store', err);
        setProblem('store');
      }
      await open(track, buffer, seq);
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  };

  const openStored = async (track: Track) => {
    if (current?.id === track.id) return;
    const seq = ++loadSeq.current;
    setProblem(null);
    pauseTrack();
    setBusy(true);
    try {
      const row = await dbGet('blobs', track.id);
      if (!isTrackAudio(row)) {
        setProblem('missing');
        return;
      }
      await open(track, await decodeAudio(fromBase64(row.base64)), seq);
    } catch (err) {
      console.error('[tracks] open', err);
      setProblem('decode');
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  };

  /** Parça ayarını değiştirir, oynatıcıya uygular ve (kütüphanedeyse) kaydeder. */
  const update = (patch: Partial<Pick<Track, 'speed' | 'semitones' | 'loopA' | 'loopB'>>) => {
    if (!current) return;
    const next: Track = { ...current, ...patch };
    setCurrent(next);
    setTrackParams(next.speed, next.semitones);
    setTrackLoop(next.loopA, next.loopB);
    if (tracks?.some((x) => x.id === next.id)) {
      setTracks(tracks.map((x) => (x.id === next.id ? next : x)));
      void dbPut('items', next);
    }
  };

  const remove = async () => {
    if (!current || !confirm(t('track.deleteConfirm'))) return;
    loadSeq.current++;
    unloadTrack();
    await dbDelete('items', current.id);
    await dbDelete('blobs', current.id);
    setCurrent(null);
    await refresh();
  };

  const loop: Loop = { a: current?.loopA ?? null, b: current?.loopB ?? null };
  const duration = playback.duration;
  const setLoop = (next: Loop) => {
    update({ loopA: next.a, loopB: next.b });
    // Döngü kurulduğunda konum dışarıdaysa başına al.
    if (loopActive(next) && (playback.position < next.a || playback.position > next.b)) seekTrack(next.a);
  };
  const decimal = lang === 'tr' ? ',' : '.';
  const fmtDate = (d: number) => new Date(d).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', { day: 'numeric', month: 'short' });

  return (
    <div class="stack">
      <Card testid="track-pick">
        {problem && (
          <Notice kind={problem === 'store' ? 'info' : 'error'} testid="track-error">
            {t(`track.err.${problem}` as Key, { mb: MAX_FILE_BYTES / 1_000_000, min: MAX_TRACK_SECONDS / 60 })}
          </Notice>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac"
          hidden
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            // Aynı dosya yeniden seçilebilsin.
            input.value = '';
            if (file) void onFile(file);
          }}
          data-testid="track-file"
        />
        <button type="button" class="btn primary block big" onClick={() => fileInput.current?.click()} disabled={busy} data-testid="track-choose">
          <Icon name="file" /> {busy ? t('track.loading') : t('track.pick')}
        </button>
        <p class="help">{t('track.hint', { mb: MAX_FILE_BYTES / 1_000_000, min: MAX_TRACK_SECONDS / 60 })}</p>
      </Card>

      {current && playback.loaded && (
        <Card testid="track-player">
          <div class="rec-head">
            <div class="rec-title">
              <strong data-testid="track-name">{current.name}</strong>
              <span class="help">
                {formatDuration(current.seconds)} · {formatBytes(current.bytes, decimal)}
              </span>
            </div>
            <button type="button" class="btn icon-only danger" aria-label={t('common.delete')} onClick={() => void remove()} data-testid="track-delete">
              <Icon name="trash" />
            </button>
          </div>
          <Waveform
            peaks={current.peaks}
            cursor={duration > 0 ? Math.min(1, playback.position / duration) : 0}
            region={loopActive(loop) && duration > 0 ? [loop.a / duration, loop.b / duration] : null}
            onSeek={(f) => seekTrack(f * duration)}
            title={t('rec.waveform', { name: current.name })}
            testid="track-wave"
            uid="track"
            height={84}
          />
          <div
            class="rec-time"
            data-testid="track-time"
            data-position={playback.position.toFixed(3)}
            data-playing={playback.playing ? 'true' : 'false'}
          >
            {formatClock(playback.position)} / {formatClock(duration)}
          </div>
          <div class="transport">
            <button
              type="button"
              class="btn big"
              aria-label={t('track.back')}
              onClick={() => seekTrack(skipTo(playback.position, -5, duration, loop))}
              data-testid="track-back"
            >
              −5
            </button>
            {playback.playing ? (
              <button type="button" class="btn primary big" onClick={pauseTrack} data-testid="track-play">
                <Icon name="stop" /> {t('track.pause')}
              </button>
            ) : (
              <button type="button" class="btn primary big" onClick={() => void playTrack()} data-testid="track-play">
                <Icon name="play" /> {t('rec.play')}
              </button>
            )}
            <button
              type="button"
              class="btn big"
              aria-label={t('track.fwd')}
              onClick={() => seekTrack(skipTo(playback.position, 5, duration, loop))}
              data-testid="track-fwd"
            >
              +5
            </button>
          </div>

          <div class="field">
            <span class="field-label">{t('track.speed')}</span>
            <Stepper
              label={t('track.speed')}
              value={current.speed}
              min={MIN_SPEED_PERCENT}
              max={MAX_SPEED_PERCENT}
              step={SPEED_STEP}
              format={(v) => `%${v}`}
              onChange={(v) => update({ speed: clampSpeed(v) })}
              testid="track-speed"
            />
            <div class="chips">
              {SPEED_PRESETS.map((p) => (
                <button
                  type="button"
                  class={`chip ${current.speed === p ? 'active' : ''}`}
                  aria-pressed={current.speed === p}
                  onClick={() => update({ speed: p })}
                  data-testid={`track-speed-${p}`}
                >
                  %{p}
                </button>
              ))}
            </div>
          </div>

          <div class="field">
            <span class="field-label">{t('track.pitch')}</span>
            <Stepper
              label={t('track.pitch')}
              value={current.semitones}
              min={-MAX_SHIFT}
              max={MAX_SHIFT}
              format={(v) => t('track.semitones', { n: shiftLabel(v) })}
              onChange={(v) => update({ semitones: clampShift(v) })}
              testid="track-pitch"
            />
          </div>

          <div class="field">
            <span class="field-label">{t('track.loop')}</span>
            <div class="transport">
              <button
                type="button"
                class={`btn ${loop.a !== null ? 'marked' : ''}`}
                onClick={() => setLoop(setLoopStart(loop, playback.position, duration))}
                data-testid="track-set-a"
              >
                A{loop.a !== null ? ` · ${formatClock(loop.a)}` : ''}
              </button>
              <button
                type="button"
                class={`btn ${loop.b !== null ? 'marked' : ''}`}
                onClick={() => setLoop(setLoopEnd(loop, playback.position, duration))}
                data-testid="track-set-b"
              >
                B{loop.b !== null ? ` · ${formatClock(loop.b)}` : ''}
              </button>
              <button
                type="button"
                class="btn"
                aria-label={t('track.clearLoop')}
                onClick={() => setLoop({ a: null, b: null })}
                disabled={loop.a === null && loop.b === null}
                data-testid="track-clear-loop"
              >
                <Icon name="loop" /> ✕
              </button>
            </div>
            <p class="help" data-testid="track-loop-info">
              {loopActive(loop) ? t('track.loopOn', { a: formatClock(loop.a), b: formatClock(loop.b) }) : t('track.loopOff')}
            </p>
          </div>
        </Card>
      )}

      <Card title={t('track.library')} testid="track-library">
        {tracks && tracks.length === 0 && <p class="help" data-testid="track-empty">{t('track.empty')}</p>}
        {tracks && tracks.length > 0 && (
          <>
            <div class="take-list">
              {tracks.map((x) => (
                <button
                  type="button"
                  class={`take ${x.id === current?.id ? 'active' : ''}`}
                  aria-pressed={x.id === current?.id}
                  onClick={() => void openStored(x)}
                  disabled={busy}
                  data-testid="track-item"
                >
                  <span class="take-text">
                    <strong>{x.name}</strong>
                    <small>
                      {fmtDate(x.date)} · {formatDuration(x.seconds)}
                      {x.speed !== 100 ? ` · %${x.speed}` : ''}
                      {x.semitones !== 0 ? ` · ${shiftLabel(x.semitones)}` : ''}
                    </small>
                  </span>
                  <Waveform peaks={x.peaks} title={t('rec.waveform', { name: x.name })} uid={`t-${x.id}`} height={36} />
                </button>
              ))}
            </div>
            <p class="help" data-testid="track-total">
              {t('track.total', { n: tracks.length, size: formatBytes(totalBytes(tracks), decimal) })}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
