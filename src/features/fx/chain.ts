import workletUrl from '../../audio/fx.worklet.ts?worker&url';
import {
  dbToGain,
  delaySeconds,
  driveCurve,
  driveLevelGain,
  faderGain,
  feedbackGain,
  reverbImpulse,
  safetyCurve,
  toneHz,
  wetGain,
} from '../../dsp/fx';
import type { FxPreset, InputParams } from './logic';

/**
 * Canlı efekt zinciri (Web Audio). Hem canlı AudioContext'te hem de testlerde OfflineAudioContext'te aynı kod kurulur.
 *
 *   giriş kazancı → [kapı] → [overdrive: alçak kesen → WaveShaper ×4 → ton → seviye] → [delay] → [reverb]
 *     → geçiş kazancı → ana ses → (ölçer) → güvenlik kırpıcısı → sessiz/açık → çıkış
 *
 * Kapalı bir efekt zincirden tamamen çıkarılır (bağlantılar yeniden kurulur): kapalıyken sese hiç dokunmaz.
 * Zincirin sonunda kompresör yok: DynamicsCompressor ileriye bakmak için sinyali geciktirir; onun yerine
 * gecikmesiz bir yumuşak kırpıcı (WaveShaper, aşırı örneklemesiz) kullanılır.
 */

export interface ChainSettings {
  input: InputParams;
  preset: FxPreset;
  /** Ana ses (%). */
  volume: number;
  /** Delay tempo senkronu için. */
  bpm: number;
}

type StageId = 'gate' | 'drive' | 'delay' | 'reverb';

export interface FxChain {
  /** Giriş sinyali buraya bağlanır (tek kanala indirilir). */
  input: AudioNode;
  /** Çıkış (sessiz/açık kazancından sonra). */
  output: AudioNode;
  /** Ana sesten sonra, güvenlik kırpıcısından önce: çıkış seviyesi ve geri besleme koruması burayı ölçer. */
  meter: AnalyserNode;
  apply(settings: ChainSettings): void;
  setMuted(muted: boolean): void;
  dispose(): void;
}

/**
 * Overdrive açıkken WaveShaper'ın 4× aşırı örnekleme süzgeçlerinin eklediği gecikme (örnek). Chromium'da ölçülen:
 * 'none' 0, '2x' 128, '4x' 192 örnek (bkz. `effects.spec.ts`). Zincirin geri kalanı gecikme eklemez.
 */
export const DRIVE_LATENCY_SAMPLES = 192;

/** Güvenlik kırpıcısının karşıladığı en büyük giriş (×4 = +12 dB). */
const SAFETY_RANGE = 4;

const modules = new WeakMap<BaseAudioContext, Promise<void>>();

function loadWorklet(ctx: BaseAudioContext): Promise<void> {
  let p = modules.get(ctx);
  if (!p) {
    p = ctx.audioWorklet.addModule(workletUrl);
    modules.set(ctx, p);
  }
  return p;
}

export async function createFxChain(ctx: BaseAudioContext, initial: ChainSettings, opts: { smooth?: boolean } = {}): Promise<FxChain> {
  await loadWorklet(ctx);
  const smooth = opts.smooth ?? false;

  const inGain = ctx.createGain();
  inGain.channelCount = 1;
  inGain.channelCountMode = 'explicit';
  inGain.channelInterpretation = 'speakers';

  const gate = new AudioWorkletNode(ctx, 'gitar-gate', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
  });

  // Overdrive
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 80;
  hpf.Q.value = 0.7;
  const shaper = ctx.createWaveShaper();
  shaper.oversample = '4x';
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.Q.value = 0.7;
  const driveOut = ctx.createGain();
  hpf.connect(shaper).connect(tone).connect(driveOut);

  // Delay (worklet): kuru sinyal hep geçer; geri besleme örnek hassasiyetinde (DelayNode döngüsü her turda
  // 128 örnek ekliyor, bkz. FeedbackDelay).
  const delay = new AudioWorkletNode(ctx, 'gitar-delay', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
    channelCountMode: 'explicit',
  });
  const param = (node: AudioWorkletNode, name: string) => node.parameters.get(name)!;

  // Reverb
  const revIn = ctx.createGain();
  const revOut = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  const revWet = ctx.createGain();
  revIn.connect(revOut);
  revIn.connect(convolver).connect(revWet).connect(revOut);

  // Çıkış
  const fade = ctx.createGain();
  const volume = ctx.createGain();
  const meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  const safetyIn = ctx.createGain();
  safetyIn.gain.value = 1 / SAFETY_RANGE;
  const safety = ctx.createWaveShaper();
  safety.curve = safetyCurve(SAFETY_RANGE) as Float32Array<ArrayBuffer>;
  safety.oversample = 'none';
  const mute = ctx.createGain();
  mute.gain.value = 0;
  fade.connect(volume);
  volume.connect(meter);
  volume.connect(safetyIn).connect(safety).connect(mute);

  const stages: Record<StageId, { in: AudioNode; out: AudioNode }> = {
    gate: { in: gate, out: gate },
    drive: { in: hpf, out: driveOut },
    delay: { in: delay, out: delay },
    reverb: { in: revIn, out: revOut },
  };

  let wiring: string | null = null;
  let wanted: StageId[] = [];
  let fadeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDrive = -1;
  let lastReverb = '';

  const rewire = (order: StageId[]) => {
    const key = order.join(',');
    if (key === wiring) return;
    wiring = key;
    inGain.disconnect();
    for (const id of Object.keys(stages) as StageId[]) stages[id].out.disconnect();
    let prev: AudioNode = inGain;
    for (const id of order) {
      prev.connect(stages[id].in);
      prev = stages[id].out;
    }
    prev.connect(fade);
  };

  const set = (param: AudioParam, value: number, tau = 0.03) => {
    if (smooth) param.setTargetAtTime(value, ctx.currentTime, tau);
    else param.value = value;
  };

  const apply = (s: ChainSettings) => {
    const { drive: d, delay: e, reverb: r } = s.preset;
    set(inGain.gain, dbToGain(s.input.gainDb));
    set(param(gate, 'threshold'), s.input.gateDb, 0.01);

    if (d.drive !== lastDrive) {
      lastDrive = d.drive;
      shaper.curve = driveCurve(d.drive) as Float32Array<ArrayBuffer>;
    }
    set(tone.frequency, toneHz(d.tone));
    set(driveOut.gain, driveLevelGain(d.level, d.drive));

    // Süre değişimini worklet kendisi yumuşatır; burada doğrudan ver.
    param(delay, 'time').setValueAtTime(delaySeconds(e, s.bpm), ctx.currentTime);
    set(param(delay, 'feedback'), feedbackGain(e.feedback));
    set(param(delay, 'mix'), wetGain(e.mix));

    const revKey = `${r.size}|${r.decay}`;
    if (revKey !== lastReverb) {
      lastReverb = revKey;
      const ir = reverbImpulse(ctx.sampleRate, r.decay, r.size, 2);
      const buffer = ctx.createBuffer(2, ir[0].length, ctx.sampleRate);
      ir.forEach((ch, i) => buffer.getChannelData(i).set(ch));
      convolver.buffer = buffer;
    }
    set(revWet.gain, wetGain(r.mix));

    set(volume.gain, faderGain(s.volume, 0), 0.05);

    const order: StageId[] = [];
    if (s.input.gateOn) order.push('gate');
    if (d.on) order.push('drive');
    if (e.on) order.push('delay');
    if (r.on) order.push('reverb');
    wanted = order;
    if (!smooth || wiring === null) {
      rewire(order);
      return;
    }
    if (order.join(',') === wiring || fadeTimer !== null) return;
    // Bağlantı değişirken tıkırtı olmasın: kısa bir sessizlik içinde yeniden bağla.
    fade.gain.setTargetAtTime(0, ctx.currentTime, 0.004);
    fadeTimer = setTimeout(() => {
      fadeTimer = null;
      rewire(wanted);
      fade.gain.setTargetAtTime(1, ctx.currentTime, 0.006);
    }, 25);
  };

  apply(initial);

  return {
    input: inGain,
    output: mute,
    meter,
    apply,
    setMuted(muted) {
      if (smooth) mute.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.01);
      else mute.gain.value = muted ? 0 : 1;
    },
    dispose() {
      if (fadeTimer !== null) clearTimeout(fadeTimer);
      for (const n of [inGain, gate, hpf, shaper, tone, driveOut, delay]) n.disconnect();
      for (const n of [revIn, convolver, revWet, revOut, fade, volume, meter, safetyIn, safety, mute]) n.disconnect();
    },
  };
}

/** impulse: 0,5 genlikli tek örnek · tone: 0,3 genlikli 220 Hz sinüs · samples: verilen örnekler. */
export type TestSignal = 'impulse' | 'tone' | 'samples';

/**
 * Zinciri çevrimdışı işler (uçtan uca testlerde ölçüm için). Giriş sinyali 0,1 s'de başlar.
 * Çıkışın 0. kanalını ve giriş sinyalini döndürür.
 */
export async function renderFxOffline(
  settings: ChainSettings,
  signal: TestSignal,
  seconds: number,
  sampleRate = 48000,
  samples?: ArrayLike<number>,
): Promise<{ input: number[]; output: number[] }> {
  const length = Math.ceil(seconds * sampleRate);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const chain = await createFxChain(ctx, settings);
  chain.setMuted(false);
  const input = new Float32Array(length);
  const start = Math.round(0.1 * sampleRate);
  if (signal === 'impulse') input[start] = 0.5;
  else if (signal === 'tone') {
    for (let i = start; i < length; i++) {
      const t = (i - start) / sampleRate;
      input[i] = 0.3 * Math.min(1, t / 0.005) * Math.sin(2 * Math.PI * 220 * t);
    }
  } else if (samples) {
    for (let i = 0; i < samples.length && start + i < length; i++) input[start + i] = samples[i];
  }
  const buffer = ctx.createBuffer(1, length, sampleRate);
  buffer.getChannelData(0).set(input);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(chain.input);
  chain.output.connect(ctx.destination);
  src.start(0);
  const out = (await ctx.startRendering()).getChannelData(0);
  return { input: Array.from(input), output: Array.from(out) };
}
