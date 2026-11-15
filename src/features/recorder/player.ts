import { signal } from '@preact/signals';
import { audioCtx, masterOut, resumeAudio } from '../../audio/engine';
import { dbGet } from '../../db/db';
import { fromBase64, isTakeAudio } from './takes';

/** Kayıtları çalar: tek kayıt ya da karşılaştırma için aynı andan başlayan iki kayıt (A/B geçişli). */

export interface PlayState {
  ids: string[];
  /** Duyulan kaydın dizini (karşılaştırmada 0 = A, 1 = B). */
  active: number;
  /** Konum 0'ın AudioContext saatindeki karşılığı. */
  startedAt: number;
  /** Ortak süre: en uzun kaydın süresi. */
  duration: number;
}

export const playState = signal<PlayState | null>(null);

const cache = new Map<string, AudioBuffer>();
let voices: { src: AudioBufferSourceNode; gain: GainNode }[] = [];
let endTimer: ReturnType<typeof setTimeout> | null = null;

export function cacheBuffer(id: string, buffer: AudioBuffer): void {
  cache.set(id, buffer);
}

export function forgetBuffer(id: string): void {
  cache.delete(id);
}

export async function decodeAudio(bytes: Uint8Array): Promise<AudioBuffer> {
  // decodeAudioData verdiğimiz belleği sahiplenir: kopyasını ver.
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return audioCtx().decodeAudioData(copy);
}

/** Kaydın çözülmüş sesini döndürür (ilk seferde veritabanından okuyup çözer). */
export async function loadBuffer(id: string): Promise<AudioBuffer> {
  const hit = cache.get(id);
  if (hit) return hit;
  const row = await dbGet('blobs', id);
  if (!isTakeAudio(row)) throw new Error('missing-audio');
  const buffer = await decodeAudio(fromBase64(row.base64));
  cache.set(id, buffer);
  return buffer;
}

export function stopTakes(): void {
  if (endTimer !== null) clearTimeout(endTimer);
  endTimer = null;
  for (const v of voices) {
    try {
      v.src.stop();
    } catch {
      // Hiç başlamamış ya da çoktan bitmiş.
    }
    v.src.disconnect();
    v.gain.disconnect();
  }
  voices = [];
  if (playState.peek()) playState.value = null;
}

/** Şu anki çalma konumu (saniye); çalmıyorsa 0. */
export function playPosition(): number {
  const s = playState.peek();
  if (!s) return 0;
  return Math.max(0, Math.min(s.duration, audioCtx().currentTime - s.startedAt));
}

/**
 * Kayıtları aynı konumdan birlikte başlatır; yalnızca `active` olan duyulur.
 * @param offset Başlangıç konumu (saniye).
 */
export async function playTakes(ids: string[], offset = 0, active = 0): Promise<void> {
  const ctx = await resumeAudio();
  const buffers = await Promise.all(ids.map(loadBuffer));
  stopTakes();
  const duration = Math.max(...buffers.map((b) => b.duration));
  const from = Math.max(0, Math.min(offset, Math.max(0, duration - 0.05)));
  const when = ctx.currentTime + 0.04;
  voices = buffers.map((buffer, i) => {
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = i === active ? 1 : 0;
    src.connect(gain).connect(masterOut());
    if (from < buffer.duration) src.start(when, from);
    return { src, gain };
  });
  playState.value = { ids, active, startedAt: when - from, duration };
  endTimer = setTimeout(stopTakes, (duration - from + 0.1) * 1000);
}

/** Çalarken duyulan kaydı değiştirir (kısa geçişle, tıkırtısız). */
export function setActiveTake(active: number): void {
  const s = playState.peek();
  if (!s) return;
  const now = audioCtx().currentTime;
  voices.forEach((v, i) => v.gain.gain.setTargetAtTime(i === active ? 1 : 0, now, 0.012));
  playState.value = { ...s, active };
}
