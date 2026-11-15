/// <reference path="../worklet-env.d.ts" />
import { TimeStretcher } from '../dsp/stretch';

export type StretchCommand =
  | { type: 'load'; samples: Float32Array }
  | { type: 'unload' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; position: number }
  | { type: 'params'; speed: number; semitones: number }
  | { type: 'loop'; a: number | null; b: number | null };

export type StretchEvent =
  | { type: 'ready'; length: number }
  | { type: 'pos'; position: number; playing: boolean }
  | { type: 'ended' };

/** Konum bildirimi aralığı (örnek): ~20 ms. */
const REPORT_EVERY = 1024;
/** Başlat/duraklat geçişi (saniye): tıkırtı olmasın. */
const FADE = 0.012;

/**
 * Yüklenen sesi istenen hız ve tonla gerçek zamanlı çalar (WSOLA). Ses verisi ana iş parçacığından bir kez
 * aktarılır; hız, ton, konum ve döngü çalarken değiştirilebilir.
 */
class StretchProcessor extends AudioWorkletProcessor {
  private stretcher: TimeStretcher | null = null;
  private playing = false;
  private level = 0;
  private sinceReport = 0;
  private speed = 1;
  private semitones = 0;
  private readonly step = 1 / (FADE * sampleRate);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<StretchCommand>) => this.handle(e.data);
  }

  private handle(msg: StretchCommand): void {
    switch (msg.type) {
      case 'load':
        this.stretcher = new TimeStretcher(msg.samples, sampleRate);
        this.stretcher.setSpeed(this.speed);
        this.stretcher.setSemitones(this.semitones);
        this.playing = false;
        this.level = 0;
        this.port.postMessage({ type: 'ready', length: msg.samples.length } satisfies StretchEvent);
        break;
      case 'unload':
        this.stretcher = null;
        this.playing = false;
        this.level = 0;
        break;
      case 'play':
        if (this.stretcher) {
          if (this.stretcher.ended) this.stretcher.seek(0);
          this.playing = true;
        }
        break;
      case 'pause':
        this.playing = false;
        break;
      case 'seek':
        this.stretcher?.seek(msg.position);
        this.report();
        break;
      case 'params':
        this.speed = msg.speed;
        this.semitones = msg.semitones;
        this.stretcher?.setSpeed(msg.speed);
        this.stretcher?.setSemitones(msg.semitones);
        break;
      case 'loop':
        this.stretcher?.setLoop(msg.a, msg.b);
        break;
    }
  }

  private report(): void {
    if (!this.stretcher) return;
    this.port.postMessage({ type: 'pos', position: this.stretcher.position, playing: this.playing } satisfies StretchEvent);
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const first = out[0];
    const st = this.stretcher;
    if (!st || !first || (!this.playing && this.level <= 0)) return true;

    st.process(first);
    const target = this.playing ? 1 : 0;
    for (let i = 0; i < first.length; i++) {
      if (this.level < target) this.level = Math.min(target, this.level + this.step);
      else if (this.level > target) this.level = Math.max(target, this.level - this.step);
      first[i] *= this.level;
    }
    for (let c = 1; c < out.length; c++) out[c].set(first);

    if (st.ended && this.playing) {
      this.playing = false;
      this.level = 0;
      this.port.postMessage({ type: 'ended' } satisfies StretchEvent);
    }
    this.sinceReport += first.length;
    if (this.sinceReport >= REPORT_EVERY) {
      this.sinceReport = 0;
      this.report();
    }
    return true;
  }
}

registerProcessor('gitar-stretch', StretchProcessor);
