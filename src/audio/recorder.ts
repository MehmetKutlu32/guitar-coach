import { audioCtx } from './engine';
import { acquireInput, inputNode } from './input';

/** Ses girişini MediaRecorder ile sıkıştırılmış (Opus/AAC) olarak kaydeder. */

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined';
}

function pickMime(): string {
  for (const m of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

export interface RecordedAudio {
  blob: Blob;
  mime: string;
}

export interface ActiveRecording {
  /** Kaydı bitirir ve sıkıştırılmış sesi döndürür. */
  stop(): Promise<RecordedAudio>;
  /** Kaydı atar. */
  cancel(): void;
}

/**
 * Kaydı başlatır. Giriş, Ayarlar'da seçili cihazdan (ya da testte üretilmiş sinyalden) alınır;
 * giriş açılamazsa `acquireInput` hatası aynen fırlatılır.
 */
export async function startRecording(): Promise<ActiveRecording> {
  const release = await acquireInput();
  const source = inputNode();
  if (!source) {
    release();
    throw new Error('no-input');
  }
  const ctx = audioCtx();
  const dest = ctx.createMediaStreamDestination();
  source.connect(dest);
  const mime = pickMime();
  const recorder = new MediaRecorder(dest.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 96_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    try {
      source.disconnect(dest);
    } catch {
      // Giriş bu arada kapanmış olabilir.
    }
    dest.stream.getTracks().forEach((t) => t.stop());
    release();
  };
  recorder.start(1000);

  return {
    stop: () =>
      new Promise<RecordedAudio>((resolve, reject) => {
        if (recorder.state === 'inactive') {
          cleanup();
          reject(new Error('not-recording'));
          return;
        }
        recorder.onstop = () => {
          cleanup();
          const type = recorder.mimeType || mime || 'audio/webm';
          resolve({ blob: new Blob(chunks, { type }), mime: type });
        };
        recorder.onerror = () => {
          cleanup();
          reject(new Error('recorder-error'));
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== 'inactive') recorder.stop();
      cleanup();
    },
  };
}
