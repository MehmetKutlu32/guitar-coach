import { StepClock } from './audio/clock';
import { outputRms } from './audio/engine';
import { flushPersistent } from './db/persist';
import { metronome, scheduleClick } from './audio/metronome';

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

export function installDebugHooks(): void {
  window.__gitar = { metronome, renderClicks, outputRms, flush: flushPersistent };
}
