let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** Tek, paylaşılan AudioContext. İlk çağrı bir kullanıcı hareketi içinde olmalı. */
export function audioCtx(): AudioContext {
  if (!ctx) {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0.9;
    // Üst üste binen seslerde kırpılmayı önleyen yumuşak sınırlayıcı.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    master.connect(limiter).connect(ctx.destination);
    // Çıkışı ölçmek için (seviye göstergeleri ve otomatik testler).
    outputTap = ctx.createAnalyser();
    outputTap.fftSize = 2048;
    limiter.connect(outputTap);
  }
  return ctx;
}

let outputTap: AnalyserNode | null = null;
const tapBuffer = new Float32Array(2048);

/** Ana çıkışı (sınırlayıcıdan sonra) başka bir düğüme de bağlar: testlerde hoparlör→mikrofon yolunu taklit eder. */
export function tapOutput(node: AudioNode): void {
  audioCtx();
  outputTap!.connect(node);
}

/** Ana çıkışın o anki RMS seviyesi (0..1). */
export function outputRms(): number {
  if (!outputTap) return 0;
  outputTap.getFloatTimeDomainData(tapBuffer);
  let sum = 0;
  for (let i = 0; i < tapBuffer.length; i++) sum += tapBuffer[i] * tapBuffer[i];
  return Math.sqrt(sum / tapBuffer.length);
}

export function masterOut(): AudioNode {
  audioCtx();
  return master!;
}

export async function resumeAudio(): Promise<AudioContext> {
  const c = audioCtx();
  if (c.state !== 'running') await c.resume();
  return c;
}

export interface PlayOptions {
  when?: number;
  gain?: number;
  destination?: AudioNode;
}

/** Hazır örnekleri (context örnekleme hızında üretilmiş) çalar. */
export function playSamples(samples: Float32Array, opts: PlayOptions = {}): AudioBufferSourceNode {
  const c = audioCtx();
  const buffer = c.createBuffer(1, samples.length, c.sampleRate);
  buffer.getChannelData(0).set(samples);
  return playBuffer(buffer, opts);
}

export function playBuffer(buffer: AudioBuffer, opts: PlayOptions = {}): AudioBufferSourceNode {
  const c = audioCtx();
  const src = c.createBufferSource();
  src.buffer = buffer;
  const gain = c.createGain();
  gain.gain.value = opts.gain ?? 1;
  src.connect(gain).connect(opts.destination ?? masterOut());
  src.start(opts.when ?? 0);
  return src;
}
