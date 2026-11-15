import { signal } from '@preact/signals';
import { audioCtx, masterOut, resumeAudio } from '../../audio/engine';
import type { StretchCommand, StretchEvent } from '../../audio/stretch.worklet';
import workletUrl from '../../audio/stretch.worklet.ts?worker&url';

/** Ses dosyası oynatıcısı: zaman esnetme worklet'ini yönetir ve durumunu sinyal olarak yayınlar. */

export interface TrackPlayback {
  loaded: boolean;
  playing: boolean;
  /** Girişteki konum (saniye). */
  position: number;
  duration: number;
}

const EMPTY: TrackPlayback = { loaded: false, playing: false, position: 0, duration: 0 };
export const trackPlayback = signal<TrackPlayback>(EMPTY);

let node: AudioWorkletNode | null = null;
let moduleLoaded: Promise<void> | null = null;
let sampleRate = 48000;

function send(msg: StretchCommand, transfer: Transferable[] = []): void {
  node?.port.postMessage(msg, transfer);
}

async function ensureNode(): Promise<AudioWorkletNode> {
  const ctx = audioCtx();
  moduleLoaded ??= ctx.audioWorklet.addModule(workletUrl);
  await moduleLoaded;
  if (!node) {
    node = new AudioWorkletNode(ctx, 'gitar-stretch', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e: MessageEvent<StretchEvent>) => {
      const msg = e.data;
      const s = trackPlayback.peek();
      if (msg.type === 'ready') {
        trackPlayback.value = { loaded: true, playing: false, position: 0, duration: msg.length / sampleRate };
      } else if (msg.type === 'pos') {
        if (s.loaded) trackPlayback.value = { ...s, position: msg.position / sampleRate, playing: msg.playing };
      } else if (msg.type === 'ended') {
        trackPlayback.value = { ...s, playing: false, position: s.duration };
      }
    };
    node.connect(masterOut());
  }
  return node;
}

/** Tek kanallı sesi oynatıcıya yükler (örnekleme hızı AudioContext'inkiyle aynı olmalı). */
export async function loadTrackSamples(samples: Float32Array): Promise<void> {
  const ctx = audioCtx();
  sampleRate = ctx.sampleRate;
  await ensureNode();
  trackPlayback.value = EMPTY;
  await new Promise<void>((resolve) => {
    const off = trackPlayback.subscribe((s) => {
      if (s.loaded) {
        queueMicrotask(() => off());
        resolve();
      }
    });
    send({ type: 'load', samples }, [samples.buffer]);
  });
}

export function unloadTrack(): void {
  send({ type: 'unload' });
  trackPlayback.value = EMPTY;
}

export async function playTrack(): Promise<void> {
  await resumeAudio();
  const s = trackPlayback.peek();
  if (!s.loaded) return;
  send({ type: 'play' });
  trackPlayback.value = { ...s, playing: true, position: s.position >= s.duration - 0.01 ? 0 : s.position };
}

export function pauseTrack(): void {
  const s = trackPlayback.peek();
  send({ type: 'pause' });
  if (s.loaded) trackPlayback.value = { ...s, playing: false };
}

export function seekTrack(seconds: number): void {
  const s = trackPlayback.peek();
  if (!s.loaded) return;
  const to = Math.max(0, Math.min(s.duration, seconds));
  send({ type: 'seek', position: to * sampleRate });
  trackPlayback.value = { ...s, position: to };
}

/** @param speedPercent Çalma hızı (%). @param semitones Ton kaydırma (yarım ton). */
export function setTrackParams(speedPercent: number, semitones: number): void {
  send({ type: 'params', speed: speedPercent / 100, semitones });
}

/** A–B döngüsü (saniye); null ise kapalı. */
export function setTrackLoop(a: number | null, b: number | null): void {
  send({ type: 'loop', a: a === null ? null : a * sampleRate, b: b === null ? null : b * sampleRate });
}
