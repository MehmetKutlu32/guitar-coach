import { audioCtx, playBuffer, type PlayOptions } from '../engine';
import { pluck } from './karplus';

const cache = new Map<string, AudioBuffer>();

/** Verilen frekansta sentez gitar teli sesi için (önbellekli) AudioBuffer. */
export function pluckBuffer(freq: number, duration = 2.5, brightness = 0.6): AudioBuffer {
  const ctx = audioCtx();
  const key = `${freq.toFixed(2)}|${duration}|${brightness}|${ctx.sampleRate}`;
  let buf = cache.get(key);
  if (!buf) {
    const data = pluck(freq, ctx.sampleRate, duration, { brightness, seed: Math.round(freq * 7) });
    buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.getChannelData(0).set(data);
    if (cache.size > 200) cache.clear();
    cache.set(key, buf);
  }
  return buf;
}

export function playPluck(
  freq: number,
  opts: PlayOptions & { duration?: number; brightness?: number } = {},
): AudioBufferSourceNode {
  return playBuffer(pluckBuffer(freq, opts.duration ?? 2.5, opts.brightness ?? 0.6), opts);
}
