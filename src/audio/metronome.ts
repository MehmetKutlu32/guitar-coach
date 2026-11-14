import { signal } from '@preact/signals';
import { lcm, LookaheadPump, StepClock, type StepEvent, type TrainerConfig } from './clock';
import { audioCtx, masterOut, resumeAudio } from './engine';

export type ClickLevel = 'accent' | 'beat' | 'sub';

const CLICK: Record<ClickLevel, { freq: number; gain: number }> = {
  accent: { freq: 1760, gain: 0.9 },
  beat: { freq: 1175, gain: 0.65 },
  sub: { freq: 880, gain: 0.3 },
};

/** Kısa, sönümlü bir tık sesi planlar. OfflineAudioContext ile de çalışır (testlerde kullanılır). */
export function scheduleClick(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  level: ClickLevel,
  volume = 1,
): void {
  const spec = CLICK[level];
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = spec.freq;
  gain.gain.setValueAtTime(spec.gain * volume, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
  osc.connect(gain).connect(dest);
  osc.start(time);
  osc.stop(time + 0.05);
}

export interface MetronomeConfig {
  bpm: number;
  beatsPerBar: number;
  /** Vuruş başına seviye: 0 = sessiz, 1 = normal, 2 = vurgulu. */
  accents: number[];
  /** Vuruş başına tık sayısı (1 = yalnızca vuruşlar). */
  subdivision: number;
  /** Tık çalmasa da adım üretilecek ek ızgara (ör. vuruş kalıbı için vuruş başına 2 ya da 4). */
  gridPerBeat?: number;
  trainer?: TrainerConfig | null;
  /** 0..1 */
  volume?: number;
}

export interface ScheduledLog {
  index: number;
  time: number;
  scheduledAt: number;
}

/**
 * Metronom motoru. Tıklar ses saatine göre önceden planlanır; `position` sinyali
 * o an duyulan adımı (çıkış gecikmesi hesaba katılarak) gösterir.
 */
export class Metronome {
  readonly running = signal(false);
  readonly position = signal<StepEvent | null>(null);
  /** Son planlanan adımlar (zamanlama doğrulaması için). */
  readonly log: ScheduledLog[] = [];
  /** Her adım planlandığında çağrılır; ek sesleri aynı ana planlamak için. */
  onStep: ((event: StepEvent, stepsPerBeat: number) => void) | null = null;

  private cfg: MetronomeConfig | null = null;
  private clock: StepClock | null = null;
  private pump: LookaheadPump | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private pending: StepEvent[] = [];
  private stepsPerBeat = 1;

  get config(): MetronomeConfig | null {
    return this.cfg;
  }

  async start(cfg: MetronomeConfig): Promise<void> {
    const ctx = await resumeAudio();
    this.stopTimers();
    this.cfg = cfg;
    this.build(ctx.currentTime + 0.1);
    this.log.length = 0;
    this.timer = setInterval(this.tick, 25);
    this.tick();
    const frame = () => {
      this.syncPosition();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
    this.running.value = true;
  }

  stop(): void {
    this.stopTimers();
    this.clock = null;
    this.pump = null;
    this.pending = [];
    this.position.value = null;
    this.running.value = false;
  }

  /** Çalışırken ayarları günceller. Ölçü yapısı değişirse saat baştan kurulur. */
  update(cfg: MetronomeConfig): void {
    const prev = this.cfg;
    this.cfg = cfg;
    if (!this.clock || !prev) return;
    const structural =
      prev.beatsPerBar !== cfg.beatsPerBar ||
      lcm(prev.subdivision, prev.gridPerBeat ?? 1) !== lcm(cfg.subdivision, cfg.gridPerBeat ?? 1);
    if (structural) {
      this.pending = [];
      this.build(audioCtx().currentTime + 0.1);
      return;
    }
    if (cfg.bpm !== prev.bpm) this.clock.setBpm(cfg.bpm);
    this.clock.setTrainer(cfg.trainer ?? null);
  }

  private build(startTime: number): void {
    const cfg = this.cfg!;
    this.stepsPerBeat = lcm(cfg.subdivision, cfg.gridPerBeat ?? 1);
    this.clock = new StepClock(startTime, {
      bpm: cfg.bpm,
      beatsPerBar: cfg.beatsPerBar,
      stepsPerBeat: this.stepsPerBeat,
      trainer: cfg.trainer ?? null,
    });
    this.pump = new LookaheadPump(this.clock, this.emit);
  }

  private stopTimers(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.raf);
  }

  private readonly tick = (): void => {
    if (!this.pump) return;
    // Gizli sekmede zamanlayıcılar seyrekleşir: daha uzağı planla.
    const lookahead = typeof document !== 'undefined' && document.hidden ? 1.6 : 0.15;
    this.pump.pump(audioCtx().currentTime, lookahead);
  };

  private readonly emit = (event: StepEvent, scheduledAt: number): void => {
    const cfg = this.cfg!;
    const ctx = audioCtx();
    const volume = cfg.volume ?? 1;
    if (event.sub === 0) {
      const level = cfg.accents[event.beat] ?? 1;
      if (level > 0) scheduleClick(ctx, masterOut(), event.time, level >= 2 ? 'accent' : 'beat', volume);
    } else if (cfg.subdivision > 1 && event.sub % (this.stepsPerBeat / cfg.subdivision) === 0) {
      scheduleClick(ctx, masterOut(), event.time, 'sub', volume);
    }
    this.onStep?.(event, this.stepsPerBeat);
    this.pending.push(event);
    this.log.push({ index: event.index, time: event.time, scheduledAt });
    if (this.log.length > 256) this.log.shift();
  };

  private syncPosition(): void {
    const ctx = audioCtx();
    // Ses, currentTime'dan çıkış gecikmesi kadar sonra duyulur.
    const heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    let latest: StepEvent | null = null;
    while (this.pending.length > 0 && this.pending[0].time <= heard) latest = this.pending.shift()!;
    if (latest) this.position.value = latest;
  }
}

/** Uygulama genelinde tek metronom (egzersizler de bunu kullanır). */
export const metronome = new Metronome();
