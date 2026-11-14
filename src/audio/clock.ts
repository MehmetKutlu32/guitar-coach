/** Web Audio'dan bağımsız, saf zamanlama mantığı. Birim testleriyle doğrulanır. */

export interface StepEvent {
  /** Başlangıçtan beri adım sırası. */
  index: number;
  /** Adımın çalınacağı an (AudioContext saniyesi). */
  time: number;
  bar: number;
  /** Ölçü içindeki vuruş (0 tabanlı). */
  beat: number;
  /** Vuruş içindeki alt adım (0 = vuruşun kendisi). */
  sub: number;
  /** Bu adımda geçerli tempo. */
  bpm: number;
}

export interface TrainerConfig {
  /** Kaç ölçüde bir hızlanılacak. */
  everyBars: number;
  /** Her seferinde eklenecek BPM. */
  increment: number;
  maxBpm: number;
}

export interface ClockConfig {
  bpm: number;
  beatsPerBar: number;
  stepsPerBeat: number;
  trainer?: TrainerConfig | null;
}

/**
 * Adım zamanlarını üretir. Zamanlar birikimli toplama ile değil, son tempo değişimindeki
 * çapa noktasından çarpma ile hesaplanır; böylece yuvarlama hatası birikmez (kayma olmaz).
 */
export class StepClock {
  readonly beatsPerBar: number;
  readonly stepsPerBeat: number;
  private bpm: number;
  private pendingBpm: number | null = null;
  private trainer: TrainerConfig | null;
  private anchorTime: number;
  private anchorStep = 0;
  private step = 0;

  constructor(startTime: number, cfg: ClockConfig) {
    this.anchorTime = startTime;
    this.bpm = cfg.bpm;
    this.beatsPerBar = cfg.beatsPerBar;
    this.stepsPerBeat = cfg.stepsPerBeat;
    this.trainer = cfg.trainer ?? null;
  }

  get stepsPerBar(): number {
    return this.beatsPerBar * this.stepsPerBeat;
  }

  get currentBpm(): number {
    return this.pendingBpm ?? this.bpm;
  }

  /** Sıradaki adımın zamanı. */
  peekTime(): number {
    return this.anchorTime + ((this.step - this.anchorStep) * 60) / this.bpm / this.stepsPerBeat;
  }

  /** Yeni tempo, sıradaki adımdan itibaren geçerli olur. */
  setBpm(bpm: number): void {
    this.pendingBpm = bpm;
  }

  setTrainer(trainer: TrainerConfig | null): void {
    this.trainer = trainer;
  }

  next(): StepEvent {
    const time = this.peekTime();
    const posInBar = this.step % this.stepsPerBar;
    const bar = Math.floor(this.step / this.stepsPerBar);

    let bpm = this.pendingBpm ?? this.bpm;
    this.pendingBpm = null;
    const tr = this.trainer;
    if (tr && posInBar === 0 && bar > 0 && bar % tr.everyBars === 0 && bpm < tr.maxBpm) {
      bpm = Math.min(tr.maxBpm, bpm + tr.increment);
    }
    if (bpm !== this.bpm) {
      this.anchorTime = time;
      this.anchorStep = this.step;
      this.bpm = bpm;
    }

    const event: StepEvent = {
      index: this.step,
      time,
      bar,
      beat: Math.floor(posInBar / this.stepsPerBeat),
      sub: posInBar % this.stepsPerBeat,
      bpm,
    };
    this.step++;
    return event;
  }

  /** Zamanı `t`'den önce olan adımları çalmadan atlar; atlanan adım sayısını döndürür. */
  skipUntil(t: number): number {
    let skipped = 0;
    while (this.peekTime() < t) {
      this.next();
      skipped++;
    }
    return skipped;
  }
}

/**
 * "İleriye bakan" zamanlayıcı: düzensiz aralıklarla çağrılan `pump`, önümüzdeki kısa pencereye düşen
 * adımları ses saatine göre kesin zamanlarıyla planlar. Zamanlayıcının gecikmesi sese yansımaz.
 */
export class LookaheadPump {
  constructor(
    private readonly clock: StepClock,
    private readonly emit: (event: StepEvent, scheduledAt: number) => void,
    private readonly lookahead = 0.15,
    /** Bu kadar gecikmiş adım yine de çalınır; daha eskileri atlanır. */
    private readonly lateTolerance = 0.025,
  ) {}

  pump(now: number, lookahead = this.lookahead): void {
    // Uzun bir duraklamadan sonra (ör. sekme uyutulduysa) geçmişte kalan adımları yığın halinde çalma.
    if (this.clock.peekTime() < now - this.lateTolerance) this.clock.skipUntil(now);
    while (this.clock.peekTime() < now + lookahead) this.emit(this.clock.next(), now);
  }
}

export const MIN_BPM = 30;
export const MAX_BPM = 260;

export function clampBpm(bpm: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)));
}

/** Dokunuşlardan tempo hesaplar: son dokunuşların ortalama aralığı. */
export class TapTempo {
  private taps: number[] = [];

  constructor(
    private readonly maxTaps = 6,
    private readonly resetMs = 2000,
  ) {}

  /** @returns En az iki dokunuş varsa BPM, yoksa null. */
  tap(nowMs: number): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && nowMs - last > this.resetMs) this.taps = [];
    this.taps.push(nowMs);
    if (this.taps.length > this.maxTaps) this.taps.shift();
    if (this.taps.length < 2) return null;
    const avg = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
    return clampBpm(60000 / avg);
  }

  reset(): void {
    this.taps = [];
  }
}

export function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/** İtalyanca tempo terimi (evrensel; çevrilmez). */
export function tempoName(bpm: number): string {
  if (bpm < 60) return 'Largo';
  if (bpm < 76) return 'Adagio';
  if (bpm < 108) return 'Andante';
  if (bpm < 120) return 'Moderato';
  if (bpm < 168) return 'Allegro';
  return 'Presto';
}
