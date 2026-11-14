import { signal } from '@preact/signals';
import { LookaheadPump, StepClock, type ClockConfig, type StepEvent } from './clock';
import { audioCtx, resumeAudio } from './engine';
import type { ScheduledLog } from './metronome';

export interface TransportOptions {
  /** Her adım planlanırken çağrılır: sesleri `event.time` anına planla. */
  onStep: (event: StepEvent, ctx: AudioContext) => void;
  /** `position` sinyaline yansıtılacak adımlar (varsayılan: yalnızca vuruş başları). */
  track?: (event: StepEvent) => boolean;
  /** İzlenen bir adım duyulduğunda çağrılır. */
  onHeard?: (event: StepEvent) => void;
  /** Başlamadan önceki boşluk (saniye). */
  leadIn?: number;
}

/**
 * Genel amaçlı çalma motoru: adımları ses saatine göre önceden planlar ve
 * o an duyulan konumu (çıkış gecikmesi hesaba katılarak) bildirir.
 * Eşlik, şarkı ve tab oynatıcıları bunu kullanır.
 */
export class Transport {
  readonly running = signal(false);
  readonly position = signal<StepEvent | null>(null);
  readonly log: ScheduledLog[] = [];

  private clock: StepClock | null = null;
  private pump: LookaheadPump | null = null;
  private opts: TransportOptions | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private raf = 0;
  private pending: StepEvent[] = [];

  async start(cfg: ClockConfig, opts: TransportOptions): Promise<void> {
    const ctx = await resumeAudio();
    this.stopTimers();
    this.opts = opts;
    this.pending = [];
    this.log.length = 0;
    this.position.value = null;
    this.clock = new StepClock(ctx.currentTime + (opts.leadIn ?? 0.12), cfg);
    this.pump = new LookaheadPump(this.clock, this.emit);
    this.timer = setInterval(this.tick, 25);
    this.tick();
    const frame = () => {
      this.sync();
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

  setBpm(bpm: number): void {
    this.clock?.setBpm(bpm);
  }

  private stopTimers(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    cancelAnimationFrame(this.raf);
  }

  private readonly tick = (): void => {
    if (!this.pump) return;
    const lookahead = typeof document !== 'undefined' && document.hidden ? 1.6 : 0.15;
    this.pump.pump(audioCtx().currentTime, lookahead);
  };

  private readonly emit = (event: StepEvent, scheduledAt: number): void => {
    const opts = this.opts!;
    opts.onStep(event, audioCtx());
    if (opts.track ? opts.track(event) : event.sub === 0) {
      this.pending.push(event);
      this.log.push({ index: event.index, time: event.time, scheduledAt });
      if (this.log.length > 256) this.log.shift();
    }
  };

  private sync(): void {
    const ctx = audioCtx();
    const heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    let latest: StepEvent | null = null;
    while (this.pending.length > 0 && this.pending[0].time <= heard) {
      latest = this.pending.shift()!;
      this.opts?.onHeard?.(latest);
      // onHeard içinde durdurulmuş olabilir.
      if (!this.running.peek()) return;
    }
    if (latest) this.position.value = latest;
  }
}
