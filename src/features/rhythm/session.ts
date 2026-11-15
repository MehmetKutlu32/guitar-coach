import { effect, signal } from '@preact/signals';
import { audioCtx, masterOut, resumeAudio } from '../../audio/engine';
import { acquireInput, configureAnalyzer, onOnset } from '../../audio/input';
import { metronome, scheduleClick } from '../../audio/metronome';
import { dbPut, newId } from '../../db/db';
import { settings } from '../../settings';
import { backing, type BackingConfig } from '../backing/player';
import { BEATS_PER_BAR, TICKS_PER_BEAT } from '../backing/styles';
import { slotForStep, type StrumPattern } from '../metronome/patterns';
import {
  analyzeRhythm,
  estimateLatency,
  liveDeviation,
  toResult,
  type LatencyEstimate,
  type RhythmAnalysis,
  type RhythmResult,
} from './analysis';

export interface RhythmConfig {
  source: 'metronome' | 'backing';
  bpm: number;
  /** Ölçülen ölçü sayısı (sayma ölçüsü hariç). */
  bars: number;
  /** Vuruş başına beklenen nota sayısı (kalıp yoksa). */
  division: number;
  /** Seçiliyse hedefler bu kalıbın vuruşlarıdır. */
  pattern: StrumPattern | null;
  /** Eşlik kaynağı için çalınacak dizi ve ayarlar. */
  backing?: BackingConfig;
  /** Kayıt için: ne çalındığının kısa adı. */
  what: string;
}

export type RhythmPhase = 'idle' | 'starting' | 'countin' | 'running' | 'done';

export interface RhythmLive {
  /** Son vuruşun sapması (ms); henüz vuruş yoksa null. */
  last: number | null;
  /** Son vuruşların sapmaları (en yenisi sonda). */
  recent: number[];
  hits: number;
  beat: number;
  /** Ölçülen ölçü (1 tabanlı); sayma sırasında 0. */
  bar: number;
}

const EMPTY_LIVE: RhythmLive = { last: null, recent: [], hits: 0, beat: -1, bar: 0 };

export const rhythmPhase = signal<RhythmPhase>('idle');
export const rhythmLive = signal<RhythmLive>(EMPTY_LIVE);
export const rhythmOutcome = signal<{ analysis: RhythmAnalysis; result: RhythmResult } | null>(null);
/** Sonuç kayıtları değişince artar. */
export const rhythmVersion = signal(0);

let cfg: RhythmConfig | null = null;
let targets: number[] = [];
let onsets: number[] = [];
let cleanup: (() => void)[] = [];
let finishTimer: ReturnType<typeof setTimeout> | null = null;

function teardown(): void {
  for (const fn of cleanup) fn();
  cleanup = [];
  if (finishTimer !== null) clearTimeout(finishTimer);
  finishTimer = null;
  metronome.onStep = null;
  backing.onPlannedStep = null;
  metronome.stop();
  backing.stop();
  configureAnalyzer({ onset: false, pitch: true });
}

async function finish(save: boolean): Promise<void> {
  const config = cfg;
  teardown();
  if (!config || !save || targets.length < 2) {
    rhythmPhase.value = 'idle';
    return;
  }
  const analysis = analyzeRhythm(targets, onsets, settings.latencyMs.peek() / 1000);
  const result = toResult(analysis, {
    id: newId(),
    date: Date.now(),
    bpm: config.bpm,
    bars: config.bars,
    what: config.what,
    source: config.source,
  });
  await dbPut('results', result);
  rhythmVersion.value++;
  rhythmOutcome.value = { analysis, result };
  rhythmPhase.value = 'done';
}

/** Ritim ölçümünü başlatır: bir ölçü sayar, sonra `bars` ölçü boyunca vuruşları hedeflerle karşılaştırır. */
export async function startRhythm(config: RhythmConfig): Promise<void> {
  teardown();
  cfg = config;
  targets = [];
  onsets = [];
  rhythmOutcome.value = null;
  rhythmLive.value = EMPTY_LIVE;
  rhythmPhase.value = 'starting';

  let release: () => void;
  try {
    release = await acquireInput();
  } catch {
    rhythmPhase.value = 'idle';
    return;
  }
  cleanup.push(release);
  configureAnalyzer({ onset: true, pitch: false });

  const latency = settings.latencyMs.peek() / 1000;
  const beatSeconds = 60 / config.bpm;
  const division = config.pattern?.division ?? config.division;
  const window = Math.min(0.15, (beatSeconds / division) * 0.45);

  cleanup.push(
    onOnset((o) => {
      onsets.push(o.time);
      const dev = liveDeviation(targets, o.time, latency, window);
      if (dev === null) return;
      const live = rhythmLive.peek();
      rhythmLive.value = { ...live, last: dev, recent: [...live.recent.slice(-11), dev], hits: live.hits + 1 };
    }),
  );

  const isTarget = (beat: number, sub: number, stepsPerBeat: number): boolean => {
    if (config.pattern) {
      const slot = slotForStep(beat, sub, stepsPerBeat, config.pattern.division);
      return slot >= 0 && config.pattern.slots[slot] !== '-';
    }
    const every = stepsPerBeat / config.division;
    return Number.isInteger(every) && sub % every === 0;
  };

  if (config.source === 'backing' && config.backing) {
    const len = config.backing.bars.length;
    backing.onPlannedStep = (ev, pos) => {
      if (pos.countIn) return;
      if (pos.cycle * len + pos.bar >= config.bars) return;
      if (isTarget(ev.beat, ev.sub, TICKS_PER_BEAT)) targets.push(ev.time);
    };
    cleanup.push(
      effect(() => {
        const pos = backing.position.value;
        if (!pos) return;
        const n = pos.countIn ? 0 : pos.cycle * len + pos.bar + 1;
        rhythmLive.value = { ...rhythmLive.peek(), beat: pos.beat, bar: Math.min(n, config.bars) };
        if (!pos.countIn && rhythmPhase.peek() === 'countin') rhythmPhase.value = 'running';
        if (n > config.bars && finishTimer === null) finishTimer = setTimeout(() => void finish(true), 60);
      }),
    );
    rhythmPhase.value = 'countin';
    await backing.start({ ...config.backing, bpm: config.bpm, countIn: true, loop: true });
  } else {
    const beats = config.pattern?.beats ?? BEATS_PER_BAR;
    const endBar = config.bars + 1;
    metronome.onStep = (ev, stepsPerBeat) => {
      if (ev.bar < 1) return;
      // Bitiş: son ölçüden sonraki "bir" de çalınır ve ölçülür.
      if (ev.bar === endBar) {
        if (ev.beat === 0 && ev.sub === 0) targets.push(ev.time);
        return;
      }
      if (isTarget(ev.beat, ev.sub, stepsPerBeat)) targets.push(ev.time);
    };
    cleanup.push(
      effect(() => {
        const pos = metronome.position.value;
        if (!pos) return;
        rhythmLive.value = { ...rhythmLive.peek(), beat: pos.beat, bar: Math.min(pos.bar, config.bars) };
        if (pos.bar >= 1 && rhythmPhase.peek() === 'countin') rhythmPhase.value = 'running';
        if (pos.bar >= endBar && finishTimer === null) {
          finishTimer = setTimeout(() => void finish(true), Math.max(250, window * 1000 + 150));
        }
      }),
    );
    rhythmPhase.value = 'countin';
    await metronome.start({
      bpm: config.bpm,
      beatsPerBar: beats,
      accents: Array.from({ length: beats }, (_, i) => (i === 0 ? 2 : 1)),
      subdivision: 1,
      gridPerBeat: division,
      endAtBar: endBar,
    });
  }
}

/** Ölçümü erken bitirir; o ana kadarki vuruşlar değerlendirilir. */
export function stopRhythm(save: boolean): void {
  if (rhythmPhase.peek() === 'idle' || rhythmPhase.peek() === 'done') return;
  // Henüz çalınmamış (ileriye planlanmış) hedefler "kaçırıldı" sayılmasın.
  const now = audioCtx().currentTime - settings.latencyMs.peek() / 1000;
  targets = targets.filter((t) => t <= now);
  void finish(save);
}

export function resetRhythm(): void {
  if (rhythmPhase.peek() === 'done') rhythmPhase.value = 'idle';
}

export type CalibrationMode = 'auto' | 'play';

export const calibrating = signal<CalibrationMode | null>(null);

/**
 * Toplam gecikmeyi ölçer.
 *  - auto: hoparlörden çalınan tıkları mikrofondan dinler (hoparlör + mikrofon gerekir).
 *  - play: kullanıcı her tıkta bir vuruş çalar (kulaklık / doğrudan bağlantı için).
 * @returns Ölçülemezse null.
 */
export async function calibrateLatency(mode: CalibrationMode): Promise<LatencyEstimate | null> {
  if (calibrating.peek()) return null;
  teardown();
  calibrating.value = mode;
  let release: (() => void) | null = null;
  const heard: number[] = [];
  let off: (() => void) | null = null;
  try {
    const ctx = await resumeAudio();
    release = await acquireInput();
    configureAnalyzer({ onset: true, pitch: false });
    off = onOnset((o) => heard.push(o.time));
    const interval = mode === 'auto' ? 0.5 : 60 / 80;
    const lead = mode === 'auto' ? 0 : 4;
    const count = 8;
    const start = ctx.currentTime + 0.4;
    const clicks: number[] = [];
    for (let i = 0; i < lead + count; i++) {
      const time = start + i * interval;
      // Çalarak ölçümde ilk 4 tık hazırlık içindir.
      scheduleClick(ctx, masterOut(), time, i < lead ? 'beat' : 'accent');
      if (i >= lead) clicks.push(time);
    }
    const total = 0.4 + (lead + count) * interval + 0.5;
    await new Promise((r) => setTimeout(r, total * 1000));
    return mode === 'auto' ? estimateLatency(clicks, heard) : estimateLatency(clicks, heard, 0.12, 0.4);
  } catch {
    return null;
  } finally {
    off?.();
    configureAnalyzer({ onset: false, pitch: true });
    release?.();
    calibrating.value = null;
  }
}
