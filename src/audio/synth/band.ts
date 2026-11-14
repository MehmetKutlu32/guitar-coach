import { midiToFreq } from '../../dsp/notes';

/**
 * Eşlik grubu için sentez sesler: davul, bas ve klavye. Hiçbir ses dosyası kullanılmaz.
 * Hepsi `BaseAudioContext` alır; böylece OfflineAudioContext ile de işlenip sınanabilir.
 */

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Tekrarlanabilir gürültü (testlerde aynı sonuç).
    let seed = 22222;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
    noiseCache.set(ctx, buf);
  }
  return buf;
}

export function kick(ctx: BaseAudioContext, dest: AudioNode, time: number, velocity = 1): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(46, time + 0.12);
  gain.gain.setValueAtTime(0.8 * velocity, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
  osc.connect(gain).connect(dest);
  osc.start(time);
  osc.stop(time + 0.32);
}

export function snare(ctx: BaseAudioContext, dest: AudioNode, time: number, velocity = 1): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.5 * velocity, time);
  ng.gain.exponentialRampToValueAtTime(0.001, time + 0.16);
  src.connect(hp).connect(ng).connect(dest);
  src.start(time);
  src.stop(time + 0.18);

  const osc = ctx.createOscillator();
  const og = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(210, time);
  osc.frequency.exponentialRampToValueAtTime(150, time + 0.07);
  og.gain.setValueAtTime(0.35 * velocity, time);
  og.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
  osc.connect(og).connect(dest);
  osc.start(time);
  osc.stop(time + 0.11);
}

/** Zil: kapalı (kısa) ya da açık/crash (uzun). */
export function hat(ctx: BaseAudioContext, dest: AudioNode, time: number, velocity = 1, open = false): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = open ? 5500 : 7500;
  const gain = ctx.createGain();
  const decay = open ? 0.55 : 0.045;
  gain.gain.setValueAtTime(0.24 * velocity, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  src.connect(hp).connect(gain).connect(dest);
  src.start(time, 0.1);
  src.stop(time + decay + 0.02);
}

export function bass(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  midi: number,
  duration: number,
  velocity = 1,
): void {
  const freq = midiToFreq(midi);
  const end = time + Math.max(0.06, duration);
  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = freq;
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = freq;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(900, time);
  lp.frequency.exponentialRampToValueAtTime(260, time + 0.18);
  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.45;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(0.3 * velocity, time + 0.008);
  gain.gain.setValueAtTime(0.3 * velocity, end);
  gain.gain.linearRampToValueAtTime(0.0001, end + 0.05);
  saw.connect(sawGain).connect(lp);
  sub.connect(lp);
  lp.connect(gain).connect(dest);
  for (const o of [saw, sub]) {
    o.start(time);
    o.stop(end + 0.06);
  }
}

/** Yumuşak elektro piyano benzeri akor. */
export function keys(
  ctx: BaseAudioContext,
  dest: AudioNode,
  time: number,
  midis: number[],
  duration: number,
  velocity = 1,
): void {
  if (midis.length === 0) return;
  const end = time + Math.max(0.08, duration);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  const gain = ctx.createGain();
  const peak = (0.5 * velocity) / Math.sqrt(midis.length);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(peak, time + 0.012);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * 0.55), Math.min(end, time + 0.5));
  gain.gain.setValueAtTime(Math.max(0.0002, peak * 0.55), end);
  gain.gain.linearRampToValueAtTime(0.0001, end + 0.1);
  lp.connect(gain).connect(dest);
  for (const midi of midis) {
    const freq = midiToFreq(midi);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.value = freq;
    const bell = ctx.createOscillator();
    bell.type = 'sine';
    bell.frequency.value = freq * 2;
    const bellGain = ctx.createGain();
    bellGain.gain.value = 0.22;
    body.connect(lp);
    bell.connect(bellGain).connect(lp);
    for (const o of [body, bell]) {
      o.start(time);
      o.stop(end + 0.12);
    }
  }
}
