import { signal } from '@preact/signals';
import workletUrl from './analyzer.worklet.ts?worker&url';
import { audioCtx, resumeAudio } from './engine';
import { settings } from '../settings';

export interface AnalysisFrame {
  /** AudioContext saatine göre çerçevenin bittiği an (saniye). */
  time: number;
  rms: number;
  peak: number;
  freq: number;
  clarity: number;
}

export type InputStatus = 'idle' | 'starting' | 'running' | 'denied' | 'unavailable' | 'error';

export const inputStatus = signal<InputStatus>('idle');
/** 0..1, dB ölçeğinde (−60 dBFS → 0, 0 dBFS → 1), tepe değeri. */
export const inputLevel = signal(0);
export const inputDevices = signal<MediaDeviceInfo[]>([]);

export interface OnsetEvent {
  /** Vuruşun girişe ulaştığı an (AudioContext saniyesi). */
  time: number;
  strength: number;
}

type Listener = (frame: AnalysisFrame) => void;
type OnsetListener = (onset: OnsetEvent) => void;
const listeners = new Set<Listener>();
const onsetListeners = new Set<OnsetListener>();
let analyzerConfig: { pitch: boolean; onset: boolean } = { pitch: true, onset: false };

let stream: MediaStream | null = null;
let source: AudioNode | null = null;
let node: AudioWorkletNode | null = null;
let sink: GainNode | null = null;
let users = 0;
let moduleLoaded: Promise<void> | null = null;
let activeDeviceId = '';

declare global {
  interface Window {
    /** Testler için: getUserMedia yerine kullanılacak kaynak (ör. üretilmiş sinyal). */
    __gitarTestInput?: (ctx: AudioContext) => AudioNode;
  }
}

export function levelToUnit(peak: number): number {
  if (peak <= 0) return 0;
  const db = 20 * Math.log10(peak);
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

export async function refreshDevices(): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const all = await navigator.mediaDevices.enumerateDevices();
  inputDevices.value = all.filter((d) => d.kind === 'audioinput');
}

async function openSource(ctx: AudioContext): Promise<AudioNode> {
  if (window.__gitarTestInput) return window.__gitarTestInput(ctx);
  if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('no getUserMedia', 'NotSupportedError');
  // Enstrüman için tarayıcının konuşma iyileştirmeleri kapatılır.
  const base: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const wanted = settings.inputDeviceId.value;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: wanted ? { ...base, deviceId: { exact: wanted } } : base,
    });
  } catch (err) {
    if (wanted && err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      // Kayıtlı cihaz artık takılı değil: varsayılana dön.
      settings.inputDeviceId.value = '';
      stream = await navigator.mediaDevices.getUserMedia({ audio: base });
    } else {
      throw err;
    }
  }
  activeDeviceId = settings.inputDeviceId.value;
  void refreshDevices();
  return ctx.createMediaStreamSource(stream);
}

function closeSource(): void {
  source?.disconnect();
  source = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function stopNodes(): void {
  if (node) {
    node.port.onmessage = null;
    node.disconnect();
    node = null;
  }
  sink?.disconnect();
  sink = null;
  closeSource();
  inputLevel.value = 0;
}

async function start(): Promise<void> {
  inputStatus.value = 'starting';
  try {
    const ctx = await resumeAudio();
    moduleLoaded ??= ctx.audioWorklet.addModule(workletUrl);
    await moduleLoaded;
    source = await openSource(ctx);
    node = new AudioWorkletNode(ctx, 'gitar-analyzer', { numberOfInputs: 1, numberOfOutputs: 1 });
    node.port.onmessage = (e: MessageEvent<(AnalysisFrame & { kind: 'frame' }) | (OnsetEvent & { kind: 'onset' })>) => {
      const msg = e.data;
      if (msg.kind === 'onset') {
        for (const l of onsetListeners) l(msg);
        return;
      }
      inputLevel.value = levelToUnit(msg.peak);
      for (const l of listeners) l(msg);
    };
    node.port.postMessage(analyzerConfig);
    // Bazı tarayıcılar yalnızca hedefe bağlı düğümleri işler: sessiz bir çıkışa bağla.
    sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node);
    node.connect(sink).connect(ctx.destination);
    inputStatus.value = 'running';
  } catch (err) {
    stopNodes();
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') inputStatus.value = 'denied';
    else if (name === 'NotFoundError' || name === 'NotSupportedError') inputStatus.value = 'unavailable';
    else inputStatus.value = 'error';
    console.error('[input]', err);
    throw err;
  }
}

/** Ses girişini kullanmaya başlar. Dönen fonksiyon çağrılınca kullanım bırakılır. */
export async function acquireInput(): Promise<() => void> {
  users++;
  if (inputStatus.value !== 'running' && inputStatus.value !== 'starting') {
    try {
      await start();
    } catch (err) {
      users = Math.max(0, users - 1);
      throw err;
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users = Math.max(0, users - 1);
    if (users === 0) {
      stopNodes();
      inputStatus.value = 'idle';
    }
  };
}

export function onAnalysis(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function onOnset(listener: OnsetListener): () => void {
  onsetListeners.add(listener);
  return () => onsetListeners.delete(listener);
}

/** Analiz modlarını aç/kapat (worklet içinde). Giriş henüz açık değilse açılınca uygulanır. */
export function configureAnalyzer(config: { pitch?: boolean; onset?: boolean }): void {
  analyzerConfig = { ...analyzerConfig, ...config };
  node?.port.postMessage(analyzerConfig);
}

/** Ayarlarda cihaz değişince, çalışan girişi yeni cihazla yeniden aç. */
export async function applyDeviceChange(): Promise<void> {
  if (inputStatus.value !== 'running' || !node || window.__gitarTestInput) return;
  if (settings.inputDeviceId.value === activeDeviceId) return;
  const ctx = audioCtx();
  closeSource();
  try {
    source = await openSource(ctx);
    source.connect(node);
  } catch (err) {
    console.error('[input] device change', err);
    stopNodes();
    inputStatus.value = 'error';
  }
}

if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => void refreshDevices());
}
