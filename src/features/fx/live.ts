import { signal } from '@preact/signals';
import { audioCtx, directOut, resumeAudio } from '../../audio/engine';
import { acquireInput, inputLatency, inputNode, levelToUnit } from '../../audio/input';
import { FFT } from '../../dsp/fft';
import { analyzeGuardFrame, CLIP_LEVEL, HowlGuard } from '../../dsp/fx';
import { createFxChain, type ChainSettings, type FxChain } from './chain';

/** Canlı dinleme: seçili giriş → efekt zinciri → kulaklık/hoparlör. Ekrandan çıkınca `stopFx` çağrılır. */

export interface FxLiveState {
  status: 'off' | 'starting' | 'on';
  muted: boolean;
  /** Koruma sesi kapattıysa nedeni. */
  tripped: 'clip' | 'howl' | null;
}

export const fxLive = signal<FxLiveState>({ status: 'off', muted: true, tripped: null });
/** Çıkış seviyesi (0..1, dB ölçeği; ana sesten sonra, güvenlik kırpıcısından önce). */
export const fxOutLevel = signal(0);
/** Son bir saniyede tam ölçeğe ulaşıldı mı? */
export const fxClip = signal(false);

/** Ölçüm ve koruma aralığı (ms). */
const POLL_MS = 50;
const CLIP_HOLD_MS = 1000;

let chain: FxChain | null = null;
let release: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let token = 0;
const guard = new HowlGuard();
const fft = new FFT(2048);
const frame = new Float32Array(2048);

function poll(last: { t: number; clipAt: number }): void {
  if (!chain) return;
  const now = performance.now();
  const dt = Math.min(0.5, (now - last.t) / 1000);
  last.t = now;
  chain.meter.getFloatTimeDomainData(frame);
  const f = analyzeGuardFrame(frame, audioCtx().sampleRate, fft);
  fxOutLevel.value = levelToUnit(f.peak);
  if (f.peak >= CLIP_LEVEL) last.clipAt = now;
  fxClip.value = now - last.clipAt < CLIP_HOLD_MS;
  const s = fxLive.peek();
  if (s.muted) {
    guard.reset();
    return;
  }
  const verdict = guard.push(f, dt);
  if (verdict !== 'ok') {
    chain.setMuted(true);
    guard.reset();
    fxLive.value = { ...s, muted: true, tripped: verdict };
  }
}

/** Girişi açar ve zinciri kurar. Çıkış her zaman sessiz başlar. */
export async function startFx(settings: ChainSettings): Promise<void> {
  if (fxLive.peek().status !== 'off') return;
  const my = ++token;
  fxLive.value = { status: 'starting', muted: true, tripped: null };
  try {
    const rel = await acquireInput();
    if (my !== token) {
      rel();
      return;
    }
    release = rel;
    const ctx = await resumeAudio();
    const c = await createFxChain(ctx, settings, { smooth: true });
    const src = inputNode();
    if (my !== token || !src) {
      c.dispose();
      if (my === token) stopFx();
      return;
    }
    chain = c;
    src.connect(c.input);
    c.output.connect(directOut());
    guard.reset();
    const last = { t: performance.now(), clipAt: -Infinity };
    timer = setInterval(() => poll(last), POLL_MS);
    fxLive.value = { status: 'on', muted: true, tripped: null };
  } catch (err) {
    console.error('[fx]', err);
    if (my === token) stopFx();
  }
}

export function stopFx(): void {
  token++;
  if (timer !== null) clearInterval(timer);
  timer = null;
  if (chain) {
    chain.setMuted(true);
    chain.dispose();
  }
  chain = null;
  release?.();
  release = null;
  fxOutLevel.value = 0;
  fxClip.value = false;
  fxLive.value = { status: 'off', muted: true, tripped: null };
}

export function updateFx(settings: ChainSettings): void {
  chain?.apply(settings);
}

export function setFxMuted(muted: boolean): void {
  const s = fxLive.peek();
  if (s.status !== 'on' || !chain) return;
  chain.setMuted(muted);
  guard.reset();
  fxLive.value = { ...s, muted, tripped: muted ? s.tripped : null };
}

/** Tarayıcının bildirdiği gecikmeler (saniye). */
export function reportedLatency(): { base: number; output: number; input: number | null; sampleRate: number } {
  const ctx = audioCtx();
  return { base: ctx.baseLatency || 0, output: ctx.outputLatency || 0, input: inputLatency(), sampleRate: ctx.sampleRate };
}
