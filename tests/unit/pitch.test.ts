import { describe, expect, it } from 'vitest';
import { PitchDetector } from '../../src/dsp/yin';
import { addNoise, pluck, rmsOf, sine } from '../../src/audio/synth/karplus';
import { centsBetween, freqToNote, midiLabel, midiToFreq, parseNote } from '../../src/dsp/notes';

const SAMPLE_RATES = [44100, 48000];
// Gitarın açık telleri + alternatif akortlar + sapın üst bölgesi.
const TEST_FREQS = [
  65.41, 73.42, 77.78, 82.41, 87.31, 98.0, 110.0, 123.47, 146.83, 164.81, 196.0, 246.94, 329.63, 440.0, 587.33,
  659.25, 880.0, 1046.5, 1318.5,
];

function frame(signal: Float32Array, start: number, size: number): Float32Array {
  return signal.subarray(start, start + size);
}

describe('PitchDetector (YIN)', () => {
  it('sinüs tonlarında ±2 cent içinde', () => {
    let worst = 0;
    for (const sr of SAMPLE_RATES) {
      const det = new PitchDetector(sr);
      for (const f of TEST_FREQS) {
        for (const detune of [-35, -7, 0, 13, 41]) {
          const target = f * Math.pow(2, detune / 1200);
          const sig = sine(target, sr, 0.25, 0.4, 0.7);
          const r = det.detect(frame(sig, 1000, det.bufferSize));
          const err = Math.abs(centsBetween(r.freq, target));
          worst = Math.max(worst, err);
          expect(err, `${target.toFixed(2)} Hz @ ${sr}`).toBeLessThan(2);
          expect(r.clarity).toBeGreaterThan(0.95);
        }
      }
    }
    console.log(`[pitch] sinüs en kötü hata: ${worst.toFixed(3)} cent`);
  });

  it('Karplus-Strong tonlarında ±2 cent içinde', () => {
    let worst = 0;
    for (const sr of SAMPLE_RATES) {
      const det = new PitchDetector(sr);
      for (const f of TEST_FREQS) {
        const sig = pluck(f, sr, 1.0, { seed: Math.round(f * 10) });
        // Atak sonrası üç farklı noktada ölç.
        for (const at of [0.08, 0.3, 0.6]) {
          const r = det.detect(frame(sig, Math.round(at * sr), det.bufferSize));
          const err = Math.abs(centsBetween(r.freq, f));
          worst = Math.max(worst, err);
          expect(err, `${f} Hz @ ${sr}, t=${at}`).toBeLessThan(2);
        }
      }
    }
    console.log(`[pitch] Karplus-Strong en kötü hata: ${worst.toFixed(3)} cent`);
  });

  it('gürültüde kararlı (SNR 20 dB ve 10 dB), oktav hatası yok', () => {
    const sr = 48000;
    const det = new PitchDetector(sr);
    const median = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)];
    const report: string[] = [];
    for (const snrDb of [20, 10]) {
      let worstFrame = 0;
      let worstMedian = 0;
      for (const f of [82.41, 110.0, 146.83, 196.0, 246.94, 329.63]) {
        const clean = pluck(f, sr, 1.2, { seed: 3, decay: 6 });
        const sigRms = rmsOf(clean, Math.round(0.1 * sr), Math.round(0.6 * sr));
        const noisy = addNoise(clean, sigRms / Math.pow(10, snrDb / 20), 11);
        const errs: number[] = [];
        for (let k = 0; k < 9; k++) {
          const r = det.detect(frame(noisy, Math.round((0.1 + k * 0.05) * sr), det.bufferSize));
          expect(r.freq, `${f} Hz, SNR ${snrDb}`).toBeGreaterThan(0);
          const err = centsBetween(r.freq, f);
          errs.push(err);
          worstFrame = Math.max(worstFrame, Math.abs(err));
          // Tek karede: oktav/yarım ton hatası yok.
          expect(Math.abs(err), `${f} Hz, SNR ${snrDb}, kare ${k}`).toBeLessThan(snrDb >= 20 ? 3 : 15);
        }
        // Arayüzün kullandığı medyan süzgeciyle.
        const med = Math.abs(median(errs));
        worstMedian = Math.max(worstMedian, med);
        expect(med, `${f} Hz, SNR ${snrDb}, medyan`).toBeLessThan(snrDb >= 20 ? 2 : 4);
      }
      report.push(`${snrDb} dB → kare ${worstFrame.toFixed(2)}c, medyan ${worstMedian.toFixed(2)}c`);
    }
    console.log('[pitch] gürültü en kötü hata: ' + report.join('; '));
  });

  it('sessizlikte ve saf gürültüde perde bildirmez', () => {
    const sr = 48000;
    const det = new PitchDetector(sr);
    expect(det.detect(new Float32Array(det.bufferSize)).freq).toBe(0);
    let detected = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const noise = addNoise(new Float32Array(det.bufferSize), 0.1, seed);
      const r = det.detect(noise);
      if (r.freq > 0 && r.clarity > 0.8) detected++;
    }
    expect(detected).toBe(0);
  });
});

describe('notes', () => {
  it('frekans ↔ nota dönüşümleri', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(40)).toBeCloseTo(82.4069, 3);
    expect(midiLabel(40)).toBe('E2');
    expect(midiLabel(64)).toBe('E4');
    expect(parseNote('E2')).toBe(40);
    expect(parseNote('Eb2')).toBe(39);
    expect(parseNote('C#4')).toBe(61);
    const n = freqToNote(446);
    expect(n.name).toBe('A');
    expect(n.octave).toBe(4);
    expect(n.cents).toBeCloseTo(23.4, 0);
    expect(freqToNote(440, 442).cents).toBeLessThan(0);
  });
});
