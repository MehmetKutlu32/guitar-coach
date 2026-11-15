import { signal } from '@preact/signals';
import type { StepEvent } from '../../audio/clock';
import { masterOut } from '../../audio/engine';
import { scheduleClick } from '../../audio/metronome';
import { playNote } from '../../audio/synth/guitar';
import { Transport } from '../../audio/transport';
import { midiToFreq } from '../../dsp/notes';
import { clampRange, notesAt, stepAt, STEPS_PER_BAR, STEPS_PER_BEAT, type PlayRange, type Tab } from '../../music/tab';

export interface TabPlayOptions {
  /** Çalma hızı çarpanı (1 = tabın temposu, 0.5 = yarı hız). */
  speed: number;
  range: PlayRange;
  /** Vuruşlarda metronom tıkı. */
  click: boolean;
  /** Başlamadan önce bir ölçü sayma. */
  countIn: boolean;
  a4?: number;
}

export interface TabPosition {
  countIn: boolean;
  /** Tab içindeki adım; sayma sırasında vuruş sırası. */
  step: number;
}

/** Tab oynatıcı: notaları sentez gitar sesiyle, ses saatine göre planlayarak çalar. */
export class TabPlayer {
  readonly transport = new Transport();
  readonly running = this.transport.running;
  readonly position = signal<TabPosition | null>(null);

  private tab: Tab | null = null;
  private opts: TabPlayOptions | null = null;

  async start(tab: Tab, opts: TabPlayOptions): Promise<void> {
    this.tab = tab;
    this.opts = { ...opts, range: clampRange(tab, opts.range) };
    this.position.value = null;
    await this.transport.start(
      { bpm: tab.bpm * opts.speed, beatsPerBar: 4, stepsPerBeat: STEPS_PER_BEAT },
      { onStep: this.onStep, onHeard: this.onHeard, track: () => true },
    );
  }

  stop(): void {
    this.transport.stop();
    this.position.value = null;
  }

  /** Çalarken hız değişimi. */
  setSpeed(speed: number): void {
    if (!this.tab || !this.opts) return;
    this.opts = { ...this.opts, speed };
    this.transport.setBpm(this.tab.bpm * speed);
  }

  private locate(event: StepEvent): TabPosition | null {
    const opts = this.opts!;
    const lead = opts.countIn ? STEPS_PER_BAR : 0;
    if (event.index < lead) return { countIn: true, step: event.beat };
    const step = stepAt(event.index - lead, opts.range);
    return step < 0 ? null : { countIn: false, step };
  }

  private readonly onStep = (event: StepEvent, ctx: AudioContext): void => {
    const tab = this.tab!;
    const opts = this.opts!;
    const pos = this.locate(event);
    if (!pos) return;
    if (event.sub === 0 && (pos.countIn || opts.click)) {
      scheduleClick(ctx, masterOut(), event.time, event.beat === 0 ? 'accent' : 'beat', pos.countIn ? 0.7 : 0.45);
    }
    if (pos.countIn) return;
    const stepSeconds = 60 / event.bpm / STEPS_PER_BEAT;
    // Döngüde nota, aralığın sonunda kesilir (başa dönünce üst üste binmesin).
    const end = (opts.range.to + 1) * STEPS_PER_BAR;
    for (const n of notesAt(tab, pos.step, end)) {
      playNote(midiToFreq(n.midi, opts.a4 ?? 440), {
        when: event.time,
        seconds: n.steps * stepSeconds,
        muted: n.muted,
        gain: 0.55,
      });
    }
  };

  private readonly onHeard = (event: StepEvent): void => {
    const pos = this.locate(event);
    if (pos) this.position.value = pos;
    else this.stop();
  };
}

export const tabPlayer = new TabPlayer();
