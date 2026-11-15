import { signal } from '@preact/signals';
import { acquireInput, configureAnalyzer, onChroma, type ChromaEvent } from '../../audio/input';
import { recognizeChord, type ChordGuess } from '../../music/recognize';

/** Bu seviyenin altındaki giriş "çalınmıyor" sayılır. */
export const LISTEN_MIN_RMS = 0.004;
/** Açık tanımada akorun gösterilmesi için gereken en düşük benzerlik. */
const SHOW_THRESHOLD = 0.78;
/** Aynı akor art arda bu kadar karede duyulunca gösterilir (~130 ms). */
const STABLE_FRAMES = 3;

export interface HeardChord {
  /** Kararlı duyulan akor; yoksa null. */
  guess: ChordGuess | null;
  /** Son karenin ham kroması ve bas notası (hedef denetimi için). */
  chroma: number[];
  bass: number;
  /** Giriş yeterince güçlü mü. */
  sounding: boolean;
}

const SILENT: HeardChord = { guess: null, chroma: [], bass: -1, sounding: false };

/** Mikrofondan o an duyulan akor. Dinleme kapalıyken boştur. */
export const heardChord = signal<HeardChord>(SILENT);
export const chordListening = signal(false);

let users = 0;
let stop: (() => void) | null = null;
let candidate = '';
let run = 0;
let shown: ChordGuess | null = null;

function onFrame(e: ChromaEvent): void {
  if (e.rms < LISTEN_MIN_RMS) {
    candidate = '';
    run = 0;
    shown = null;
    heardChord.value = { ...SILENT, chroma: e.chroma, bass: e.bass };
    return;
  }
  const guess = recognizeChord(e.chroma, e.bass);
  const symbol = guess && guess.score >= SHOW_THRESHOLD ? guess.symbol : '';
  if (symbol && symbol === candidate) run++;
  else {
    candidate = symbol;
    run = symbol ? 1 : 0;
  }
  if (run >= STABLE_FRAMES && guess) shown = guess;
  else if (!symbol) shown = null;
  heardChord.value = { guess: shown, chroma: e.chroma, bass: e.bass, sounding: true };
}

/**
 * Akor dinlemeyi başlatır (mikrofonu açar, kroma analizini etkinleştirir).
 * Dönen fonksiyon çağrılınca bırakılır; son kullanıcı bırakınca dinleme kapanır.
 */
export async function listenForChords(): Promise<() => void> {
  users++;
  if (users === 1) {
    try {
      const release = await acquireInput();
      configureAnalyzer({ chroma: true });
      const off = onChroma(onFrame);
      stop = () => {
        off();
        configureAnalyzer({ chroma: false });
        release();
      };
      chordListening.value = true;
    } catch (err) {
      users = 0;
      throw err;
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users = Math.max(0, users - 1);
    if (users === 0) {
      stop?.();
      stop = null;
      candidate = '';
      run = 0;
      shown = null;
      heardChord.value = SILENT;
      chordListening.value = false;
    }
  };
}
