/// <reference path="../worklet-env.d.ts" />
import { FeedbackDelay, MAX_DELAY_MS, NoiseGate } from '../dsp/fx';

/**
 * Canlı efektlerin örnek hassasiyeti gereken iki parçası (saf mantık `src/dsp/fx.ts`'te):
 *  - gitar-gate:  gürültü kapısı (eşik: `threshold` dBFS)
 *  - gitar-delay: geri beslemeli delay (`time` s, `feedback` 0..0,9, `mix`)
 * Ayarlar AudioParam'dır: canlıda yumuşak geçiş, çevrimdışı işlemede (testler) ilk örnekten itibaren geçerli.
 */

class GateProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'threshold', defaultValue: -55, minValue: -100, maxValue: 0, automationRate: 'k-rate' }];
  }

  private readonly gate = new NoiseGate(sampleRate, { thresholdDb: -55 });
  private threshold = -55;

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0]?.[0];
    if (!output) return true;
    const th = parameters.threshold[0];
    if (th !== this.threshold) {
      this.threshold = th;
      this.gate.setThreshold(th);
    }
    const input = inputs[0]?.[0];
    if (input) this.gate.process(input, output);
    else output.fill(0);
    return true;
  }
}

const silence = new Float32Array(128);

class DelayProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'time', defaultValue: 0.35, minValue: 0.001, maxValue: MAX_DELAY_MS / 1000, automationRate: 'k-rate' },
      { name: 'feedback', defaultValue: 0.3, minValue: 0, maxValue: 0.9, automationRate: 'k-rate' },
      { name: 'mix', defaultValue: 0.25, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  private readonly delay = new FeedbackDelay(sampleRate);

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0]?.[0];
    if (!output) return true;
    this.delay.set(parameters.time[0], parameters.feedback[0], parameters.mix[0]);
    // Giriş kesilse de yankılar sönene kadar çalışmaya devam eder.
    this.delay.process(inputs[0]?.[0] ?? silence.subarray(0, output.length), output);
    return true;
  }
}

registerProcessor('gitar-gate', GateProcessor);
registerProcessor('gitar-delay', DelayProcessor);
