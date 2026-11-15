import { midiToFreq } from '../../dsp/notes';
import { audioCtx, masterOut, playBuffer, type PlayOptions } from '../engine';
import { pluck } from './karplus';

const cache = new Map<string, AudioBuffer>();

export interface PluckSound {
  duration?: number;
  brightness?: number;
  /** Sönüm süresi (T60). Kısa değerler susturulmuş tel sesi verir. */
  decay?: number;
}

/** Verilen frekansta sentez gitar teli sesi için (önbellekli) AudioBuffer. */
export function pluckBuffer(freq: number, sound: PluckSound = {}): AudioBuffer {
  const ctx = audioCtx();
  const duration = sound.duration ?? 2.5;
  const brightness = sound.brightness ?? 0.6;
  const key = `${freq.toFixed(2)}|${duration}|${brightness}|${sound.decay ?? ''}|${ctx.sampleRate}`;
  let buf = cache.get(key);
  if (!buf) {
    const data = pluck(freq, ctx.sampleRate, duration, {
      brightness,
      decay: sound.decay,
      seed: Math.round(freq * 7),
    });
    buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.getChannelData(0).set(data);
    if (cache.size > 300) cache.clear();
    cache.set(key, buf);
  }
  return buf;
}

export function playPluck(freq: number, opts: PlayOptions & PluckSound = {}): AudioBufferSourceNode {
  return playBuffer(pluckBuffer(freq, opts), opts);
}

export interface NoteOptions {
  when?: number;
  /** Notanın süresi (saniye); sonunda kısa bir sönümle kesilir. */
  seconds: number;
  gain?: number;
  /** Susturulmuş (ölü) nota. */
  muted?: boolean;
  destination?: AudioNode;
}

/**
 * Belirli süreli tek bir nota çalar (tab oynatıcı için). Tel sesi her perde için bir kez üretilir
 * ve önbellekten kullanılır; süre, kazanç zarfıyla kesilir.
 */
export function playNote(freq: number, opts: NoteOptions): void {
  const ctx = audioCtx();
  const when = Math.max(opts.when ?? 0, ctx.currentTime);
  const buffer = opts.muted
    ? pluckBuffer(freq, { duration: 0.2, decay: 0.07, brightness: 0.9 })
    : pluckBuffer(freq, { duration: 3 });
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const gain = ctx.createGain();
  const level = opts.gain ?? 0.6;
  const end = when + Math.min(opts.seconds, buffer.duration - 0.05);
  gain.gain.setValueAtTime(level, when);
  gain.gain.setValueAtTime(level, end);
  gain.gain.linearRampToValueAtTime(0, end + 0.04);
  src.connect(gain).connect(opts.destination ?? masterOut());
  src.start(when);
  src.stop(end + 0.06);
}

export type StrumDirection = 'D' | 'U' | 'X';

export interface StrumOptions {
  when?: number;
  gain?: number;
  a4?: number;
  destination?: AudioNode;
  /** Teller arası gecikme (saniye). */
  spread?: number;
  duration?: number;
}

/**
 * Bir akoru pena vuruşu gibi çalar.
 * @param midis Çalınacak notalar, kalın telden inceye.
 * @param direction D = aşağı (kalından inceye), U = yukarı (inceden kalına, üst teller), X = susturulmuş.
 */
export function strumChord(midis: number[], direction: StrumDirection, opts: StrumOptions = {}): void {
  const ctx = audioCtx();
  const when = Math.max(opts.when ?? 0, ctx.currentTime);
  const a4 = opts.a4 ?? 440;
  const base = opts.gain ?? 0.5;
  if (midis.length === 0) return;

  let order = midis;
  let spread = opts.spread ?? 0.014;
  let gain = base;
  let sound: PluckSound = { duration: opts.duration ?? 2.2 };
  if (direction === 'U') {
    // Yukarı vuruşta pena çoğunlukla ince tellere değer.
    order = [...midis].reverse().slice(0, Math.min(4, midis.length));
    spread = opts.spread ?? 0.01;
    gain = base * 0.8;
  } else if (direction === 'X') {
    spread = 0.004;
    gain = base * 0.9;
    sound = { duration: 0.2, decay: 0.07, brightness: 0.9 };
  }
  order.forEach((midi, i) => {
    playPluck(midiToFreq(midi, a4), {
      ...sound,
      when: when + i * spread,
      gain: gain * (1 - i * 0.04),
      destination: opts.destination,
    });
  });
}
