/// <reference path="../worklet-env.d.ts" />
import { OnsetDetector } from '../dsp/onset';
import { PitchDetector } from '../dsp/yin';

const BUFFER = 4096;
const HOP = 1024;

export interface AnalyzerConfig {
  pitch?: boolean;
  onset?: boolean;
}

/**
 * Giriş sinyalini gerçek zamanlı analiz eder.
 *  - Her HOP örnekte bir seviye ve (açıksa) perde çerçevesi gönderir.
 *  - Vuruş algılama açıksa, her vuruşu ses saatindeki zamanıyla ayrıca bildirir.
 * Çok kanallı girişlerde kanalların ortalaması alınır (ses kartının 2. girişine takılı gitar da duyulur).
 */
class AnalyzerProcessor extends AudioWorkletProcessor {
  private readonly ring = new Float32Array(BUFFER);
  private readonly frame = new Float32Array(BUFFER);
  private readonly mono = new Float32Array(128);
  private readonly detector = new PitchDetector(sampleRate, { bufferSize: BUFFER });
  private readonly onsets = new OnsetDetector(sampleRate);
  private write = 0;
  private sinceHop = 0;
  private sumSq = 0;
  private peak = 0;
  private pitchOn = true;
  private onsetOn = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<AnalyzerConfig>) => {
      if (typeof e.data?.pitch === 'boolean') this.pitchOn = e.data.pitch;
      if (typeof e.data?.onset === 'boolean') {
        if (e.data.onset && !this.onsetOn) this.onsets.reset();
        this.onsetOn = e.data.onset;
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channels = input.length;
    const n = input[0].length;
    const mono = n === this.mono.length ? this.mono : new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < channels; c++) s += input[c][i];
      s /= channels;
      mono[i] = s;
      this.ring[this.write] = s;
      this.write = (this.write + 1) % BUFFER;
      this.sumSq += s * s;
      const a = s < 0 ? -s : s;
      if (a > this.peak) this.peak = a;
      if (++this.sinceHop >= HOP) this.emit();
    }
    if (this.onsetOn) {
      // currentFrame: bu bloğun ilk örneğinin ses saatindeki sırası.
      this.onsets.process(mono, currentFrame, (sample, strength) => {
        this.port.postMessage({ kind: 'onset', time: sample / sampleRate, strength });
      });
    }
    return true;
  }

  private emit(): void {
    const rms = Math.sqrt(this.sumSq / this.sinceHop);
    const peak = this.peak;
    this.sinceHop = 0;
    this.sumSq = 0;
    this.peak = 0;
    let freq = 0;
    let clarity = 0;
    if (this.pitchOn && rms > 1e-4) {
      const tail = BUFFER - this.write;
      this.frame.set(this.ring.subarray(this.write), 0);
      this.frame.set(this.ring.subarray(0, this.write), tail);
      const r = this.detector.detect(this.frame);
      freq = r.freq;
      clarity = r.clarity;
    }
    this.port.postMessage({ kind: 'frame', time: currentTime, rms, peak, freq, clarity });
  }
}

registerProcessor('gitar-analyzer', AnalyzerProcessor);
