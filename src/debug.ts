import { StepClock } from './audio/clock';
import { outputRms, tapOutput } from './audio/engine';
import { flushPersistent } from './db/persist';
import { metronome, scheduleClick } from './audio/metronome';
import { backing, BUS_GAIN, playBandEvent } from './features/backing/player';
import { BAR_TICKS, eventsAt, TICKS_PER_BEAT, type StyleId } from './features/backing/styles';
import type { RhythmResult } from './features/rhythm/analysis';
import { rhythmOutcome } from './features/rhythm/session';
import { resolveTemplate, TEMPLATES } from './music/progressions';

/**
 * Otomatik testlerin (Playwright) ölçüm yapabilmesi için küçük kancalar.
 * Uygulama davranışını değiştirmez.
 */
export interface GitarDebug {
  metronome: typeof metronome;
  /** Metronom tıklarını çevrimdışı işler ve her tıkın planlanan/gerçekleşen örnek konumunu döndürür. */
  renderClicks(bpm: number, beats: number, sampleRate?: number): Promise<{ expected: number; actual: number }[]>;
  /** Ana çıkışın o anki RMS seviyesi: "gerçekten ses çıktı mı" denetimi için. */
  outputRms(): number;
  /** Bekleyen kalıcı durum yazmaları bitince çözülür. */
  flush(): Promise<void>;
  backing: typeof backing;
  /** Ana çıkışı verilen düğüme bağlar (testte hoparlör→mikrofon geri dönüşü). */
  tapOutput(node: AudioNode): void;
  /** Son ritim ölçümünün kaydı (yoksa null). */
  rhythmResult(): RhythmResult | null;
  /** Eşlik grubunu çevrimdışı işler; karışımın ve her partinin seviyesini döndürür. */
  renderBacking(
    templateId: string,
    key: number,
    style: StyleId,
    bpm: number,
    sampleRate?: number,
  ): Promise<Record<'all' | 'drums' | 'bass' | 'chords', Level>>;
}

export interface Level {
  peak: number;
  rms: number;
  /** İşlenen seste NaN/sonsuz değer yok. */
  finite: boolean;
}

declare global {
  interface Window {
    __gitar?: GitarDebug;
  }
}

async function renderClicks(bpm: number, beats: number, sampleRate = 48000) {
  const start = 0.0123; // bilerek örnek sınırına denk gelmeyen bir an
  const clock = new StepClock(start, { bpm, beatsPerBar: 4, stepsPerBeat: 1 });
  const duration = start + (beats * 60) / bpm + 0.1;
  const ctx = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate);
  const times: number[] = [];
  for (let i = 0; i < beats; i++) {
    const ev = clock.next();
    times.push(ev.time);
    scheduleClick(ctx, ctx.destination, ev.time, ev.beat === 0 ? 'accent' : 'beat');
  }
  const data = (await ctx.startRendering()).getChannelData(0);
  return times.map((time) => {
    const expected = time * sampleRate;
    // Tıkın başladığı ilk örnek: planlanan andan biraz öncesinden ileri doğru ara.
    let i = Math.max(0, Math.floor(expected) - 64);
    while (i < data.length && Math.abs(data[i]) < 1e-4) i++;
    return { expected, actual: i };
  });
}

type Part = 'drums' | 'bass' | 'chords';
/** Eşlik ekranındaki varsayılan seviyeler (yüzde). */
const DEFAULT_LEVELS = { drums: 90, bass: 85, chords: 75 };

async function renderBacking(templateId: string, key: number, style: StyleId, bpm: number, sampleRate = 44100) {
  const template = TEMPLATES.find((p) => p.id === templateId) ?? TEMPLATES[0];
  const bars = resolveTemplate(template, key).slice(0, 4);
  const spb = 60 / bpm;
  const duration = bars.length * BAR_TICKS * (spb / TICKS_PER_BEAT) + 0.6;
  const measure = async (only: Part | 'all'): Promise<Level> => {
    const ctx = new OfflineAudioContext(1, Math.ceil(duration * sampleRate), sampleRate);
    const muted = ctx.createGain();
    muted.gain.value = 0;
    muted.connect(ctx.destination);
    // Uygulamadaki varsayılan seviyelerle aynı kazançlar.
    const bus = (p: Part): AudioNode => {
      if (only !== 'all' && only !== p) return muted;
      const g = ctx.createGain();
      g.gain.value = BUS_GAIN[p] * (DEFAULT_LEVELS[p] / 100) * 0.9;
      g.connect(ctx.destination);
      return g;
    };
    const buses = { drums: bus('drums'), bass: bus('bass'), chords: bus('chords') };
    bars.forEach((_, barIndex) => {
      for (let tick = 0; tick < BAR_TICKS; tick++) {
        const time = 0.01 + (barIndex * BAR_TICKS + tick) * (spb / TICKS_PER_BEAT);
        for (const e of eventsAt(bars, style, barIndex, tick)) playBandEvent(ctx, buses, e, time, spb);
      }
    });
    const data = (await ctx.startRendering()).getChannelData(0);
    let peak = 0;
    let sum = 0;
    let finite = true;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (!Number.isFinite(v)) finite = false;
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
    }
    return { peak, rms: Math.sqrt(sum / data.length), finite };
  };
  return { all: await measure('all'), drums: await measure('drums'), bass: await measure('bass'), chords: await measure('chords') };
}

export function installDebugHooks(): void {
  window.__gitar = {
    metronome,
    backing,
    renderClicks,
    renderBacking,
    outputRms,
    tapOutput,
    rhythmResult: () => rhythmOutcome.peek()?.result ?? null,
    flush: flushPersistent,
  };
}
