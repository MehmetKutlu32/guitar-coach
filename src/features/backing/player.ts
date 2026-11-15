import { signal } from '@preact/signals';
import type { StepEvent } from '../../audio/clock';
import { audioCtx, masterOut } from '../../audio/engine';
import { scheduleClick } from '../../audio/metronome';
import { bass, hat, keys, kick, snare } from '../../audio/synth/band';
import { Transport } from '../../audio/transport';
import type { Bar } from '../../music/progressions';
import { BEATS_PER_BAR, eventsAt, TICKS_PER_BEAT, type BandEvent, type StyleId } from './styles';

export interface BandLevels {
  drums: number;
  bass: number;
  chords: number;
}

export interface BackingConfig {
  bars: Bar[];
  bpm: number;
  style: StyleId;
  loop: boolean;
  /** Başlamadan önce bir ölçü sayma. */
  countIn: boolean;
  levels: BandLevels;
  /** Her vuruşta metronom tıkı da çalınsın mı (grup sesi kapalıyken nabız için). */
  click?: boolean;
}

export interface BackingPosition {
  /** Sayma ölçüsünde true. */
  countIn: boolean;
  /** Dizi içindeki ölçü (0 tabanlı). */
  bar: number;
  beat: number;
  /** Dizi kaçıncı kez çalınıyor (0 tabanlı). */
  cycle: number;
}

/** Parti veri yolu kazançları (kullanıcı seviyesi 1 iken). */
export const BUS_GAIN: BandLevels = { drums: 0.9, bass: 0.8, chords: 0.7 };

interface Buses {
  drums: GainNode;
  bass: GainNode;
  chords: GainNode;
}

/** Bir grup olayını verilen ana planlar. Çevrimdışı işleme (test) için de kullanılır. */
export function playBandEvent(
  ctx: BaseAudioContext,
  buses: { drums: AudioNode; bass: AudioNode; chords: AudioNode },
  event: BandEvent,
  time: number,
  secondsPerBeat: number,
): void {
  switch (event.kind) {
    case 'kick':
      kick(ctx, buses.drums, time, event.velocity);
      break;
    case 'snare':
      snare(ctx, buses.drums, time, event.velocity);
      break;
    case 'hat':
      hat(ctx, buses.drums, time, event.velocity);
      break;
    case 'crash':
      hat(ctx, buses.drums, time, event.velocity, true);
      break;
    case 'bass':
      bass(ctx, buses.bass, time, event.midi, event.beats * secondsPerBeat, event.velocity);
      break;
    case 'chord':
      keys(ctx, buses.chords, time, event.midis, event.beats * secondsPerBeat, event.velocity);
      break;
  }
}

/** Eşlik grubu: akor dizisini seçilen tarzda davul, bas ve klavyeyle çalar. */
export class BackingPlayer {
  readonly transport = new Transport();
  readonly running = this.transport.running;
  readonly position = signal<BackingPosition | null>(null);

  /** Her adım planlanırken çağrılır (ritim geri bildirimi hedef zamanlarını buradan alır). */
  onPlannedStep: ((event: StepEvent, position: BackingPosition) => void) | null = null;

  private cfg: BackingConfig | null = null;
  private buses: Buses | null = null;

  async start(cfg: BackingConfig): Promise<void> {
    if (cfg.bars.length === 0) return;
    this.cfg = cfg;
    this.position.value = null;
    await this.transport.start(
      { bpm: cfg.bpm, beatsPerBar: BEATS_PER_BAR, stepsPerBeat: TICKS_PER_BEAT },
      { onStep: this.onStep, onHeard: this.onHeard },
    );
    this.applyLevels();
  }

  stop(): void {
    this.transport.stop();
    this.position.value = null;
  }

  /** Çalarken ayar değişikliği: tempo, tarz, dizi ve seviyeler anında uygulanır. */
  update(cfg: BackingConfig): void {
    const prev = this.cfg;
    this.cfg = cfg;
    if (prev && prev.bpm !== cfg.bpm) this.transport.setBpm(cfg.bpm);
    this.applyLevels();
  }

  private ensureBuses(): Buses {
    if (!this.buses) {
      const ctx = audioCtx();
      const make = () => {
        const g = ctx.createGain();
        g.connect(masterOut());
        return g;
      };
      this.buses = { drums: make(), bass: make(), chords: make() };
    }
    return this.buses;
  }

  private applyLevels(): void {
    if (!this.cfg) return;
    const b = this.ensureBuses();
    const t = audioCtx().currentTime;
    for (const part of ['drums', 'bass', 'chords'] as const) {
      b[part].gain.setTargetAtTime(this.cfg.levels[part] * BUS_GAIN[part], t, 0.02);
    }
  }

  /** Saat ölçüsünü dizi konumuna çevirir; dizi bittiyse (döngü kapalı) null. */
  private locate(event: StepEvent): BackingPosition | null {
    const cfg = this.cfg!;
    const offset = cfg.countIn ? 1 : 0;
    if (event.bar < offset) return { countIn: true, bar: 0, beat: event.beat, cycle: 0 };
    const n = event.bar - offset;
    const len = cfg.bars.length;
    if (!cfg.loop && n >= len) return null;
    return { countIn: false, bar: n % len, beat: event.beat, cycle: Math.floor(n / len) };
  }

  private readonly onStep = (event: StepEvent, ctx: AudioContext): void => {
    const cfg = this.cfg!;
    const pos = this.locate(event);
    if (!pos) return;
    this.onPlannedStep?.(event, pos);
    const buses = this.ensureBuses();
    // Sayma ve nabız tıkları davul seviyesinden bağımsızdır: grup kısılsa da duyulur.
    if (pos.countIn) {
      if (event.sub === 0) scheduleClick(ctx, masterOut(), event.time, event.beat === 0 ? 'accent' : 'beat', 0.7);
      return;
    }
    if (cfg.click && event.sub === 0) {
      scheduleClick(ctx, masterOut(), event.time, event.beat === 0 ? 'accent' : 'beat', 0.6);
    }
    const tick = event.beat * TICKS_PER_BEAT + event.sub;
    const spb = 60 / event.bpm;
    for (const e of eventsAt(cfg.bars, cfg.style, pos.bar, tick)) playBandEvent(ctx, buses, e, event.time, spb);
  };

  private readonly onHeard = (event: StepEvent): void => {
    const pos = this.locate(event);
    if (pos) this.position.value = pos;
    else this.stop();
  };
}

export const backing = new BackingPlayer();
