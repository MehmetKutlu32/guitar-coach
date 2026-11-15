import { describe, expect, it } from 'vitest';
import { addNoise, mulberry32, pluck, rmsOf } from '../../src/audio/synth/karplus';
import { midiToFreq } from '../../src/dsp/notes';
import { detectOnsets } from '../../src/dsp/onset';

const SR = 48000;

/** Verilen anlarda (saniye) tel/akor vuruşları içeren bir sinyal üretir. */
function render(
  hits: { time: number; midis: number[]; velocity?: number; spread?: number; decay?: number }[],
  seconds: number,
  sr = SR,
): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  hits.forEach((hit, h) => {
    hit.midis.forEach((midi, i) => {
      const note = pluck(midiToFreq(midi), sr, 1.5, { seed: h * 31 + i + 1, velocity: hit.velocity ?? 0.5, decay: hit.decay });
      const start = Math.round((hit.time + i * (hit.spread ?? 0)) * sr);
      for (let k = 0; k < note.length && start + k < out.length; k++) out[start + k] += note[k];
    });
  });
  return out;
}

/** Her beklenen vuruş için en yakın algılamayı eşler; hataları (ms) ve fazla/eksikleri döndürür. */
function compare(expected: number[], detectedSamples: number[], sr = SR) {
  const detected = detectedSamples.map((s) => s / sr);
  const used = new Set<number>();
  const errors: number[] = [];
  let missed = 0;
  for (const t of expected) {
    let best = -1;
    for (let j = 0; j < detected.length; j++) {
      if (used.has(j)) continue;
      if (best < 0 || Math.abs(detected[j] - t) < Math.abs(detected[best] - t)) best = j;
    }
    if (best >= 0 && Math.abs(detected[best] - t) < 0.04) {
      used.add(best);
      errors.push((detected[best] - t) * 1000);
    } else {
      missed++;
    }
  }
  const worst = errors.reduce((m, e) => Math.max(m, Math.abs(e)), 0);
  const mean = errors.reduce((s, e) => s + e, 0) / Math.max(1, errors.length);
  return { errors, worst, mean, missed, extra: detected.length - used.size };
}

const E2 = 40;
const A2 = 45;
const D3 = 50;
const G3 = 55;
const B3 = 59;
const E4 = 64;
const EM = [E2, 47, 52, G3, B3, E4];

describe('vuruş (onset) algılama — hedef ±10 ms', () => {
  const report: string[] = [];

  it('tek tel vuruşları: farklı perdeler, 120 BPM sekizlikler', () => {
    const notes = [E2, A2, D3, G3, B3, E4, 69, 76];
    const hits = Array.from({ length: 24 }, (_, i) => ({ time: 0.2 + i * 0.25 + (i % 5) * 0.0037, midis: [notes[i % notes.length]] }));
    const sig = render(hits, 6.6);
    const r = compare(hits.map((h) => h.time), detectOnsets(sig, SR));
    expect(r.missed).toBe(0);
    expect(r.extra).toBe(0);
    expect(r.worst).toBeLessThan(10);
    report.push(`tek tel: en kötü ${r.worst.toFixed(2)} ms, ortalama ${r.mean.toFixed(2)} ms`);
  });

  it('akor vuruşları (aşağı/yukarı), üst üste binen çınlama', () => {
    const hits = Array.from({ length: 16 }, (_, i) => ({
      time: 0.3 + i * 0.3,
      midis: i % 2 === 0 ? EM : [...EM].reverse().slice(0, 4),
      spread: 0.012,
      decay: 4,
    }));
    const sig = render(hits, 6);
    const r = compare(hits.map((h) => h.time), detectOnsets(sig, SR));
    expect(r.missed).toBe(0);
    expect(r.extra).toBe(0);
    expect(r.worst).toBeLessThan(10);
    report.push(`akor: en kötü ${r.worst.toFixed(2)} ms, ortalama ${r.mean.toFixed(2)} ms`);
  });

  it('hızlı on altılıklar (160 BPM) ve değişen vuruş gücü', () => {
    const step = 60 / 160 / 4;
    const hits = Array.from({ length: 32 }, (_, i) => ({
      time: 0.2 + i * step,
      midis: [i % 2 ? G3 : D3],
      velocity: i % 4 === 0 ? 0.8 : 0.3,
    }));
    const sig = render(hits, 3.6);
    const r = compare(hits.map((h) => h.time), detectOnsets(sig, SR));
    expect(r.missed).toBe(0);
    expect(r.extra).toBe(0);
    expect(r.worst).toBeLessThan(10);
    report.push(`hızlı 16'lık: en kötü ${r.worst.toFixed(2)} ms`);
  });

  it('gürültüde (SNR 30 dB ve 20 dB)', () => {
    for (const snr of [30, 20]) {
      const hits = Array.from({ length: 16 }, (_, i) => ({ time: 0.25 + i * 0.4, midis: [[E2, A2, D3, G3][i % 4]] }));
      const clean = render(hits, 6.8);
      const level = rmsOf(clean, Math.round(0.25 * SR), Math.round(0.45 * SR));
      const noisy = addNoise(clean, level / Math.pow(10, snr / 20), 5);
      // Gürültünün t = 0'da aniden başlaması da (haklı olarak) bir vuruş sayılır; onu ölçüm dışı bırak.
      const detected = detectOnsets(noisy, SR).filter((s) => s > 0.1 * SR);
      const r = compare(hits.map((h) => h.time), detected);
      expect(r.missed, `SNR ${snr}`).toBe(0);
      expect(r.extra, `SNR ${snr}`).toBe(0);
      expect(r.worst, `SNR ${snr}`).toBeLessThan(10);
      report.push(`SNR ${snr} dB: en kötü ${r.worst.toFixed(2)} ms`);
    }
  });

  it('44,1 kHz örnekleme hızında da aynı doğruluk', () => {
    const sr = 44100;
    const hits = Array.from({ length: 12 }, (_, i) => ({ time: 0.2 + i * 0.333, midis: [[E2, G3, E4][i % 3]] }));
    const sig = render(hits, 4.4, sr);
    const r = compare(hits.map((h) => h.time), detectOnsets(sig, sr), sr);
    expect(r.missed).toBe(0);
    expect(r.extra).toBe(0);
    expect(r.worst).toBeLessThan(10);
    report.push(`44,1 kHz: en kötü ${r.worst.toFixed(2)} ms`);
  });

  it('gecikme düzeltmesinin ayarlanmadığı sinyal türleri: boğuk teller ve yumuşak ataklı vuruşlar', () => {
    // Boğuk (parlaklığı düşük) teller.
    const times = Array.from({ length: 12 }, (_, i) => 0.3 + i * 0.37);
    const dull = new Float32Array(Math.round(5 * SR));
    times.forEach((t, h) => {
      const note = pluck(midiToFreq([E2, A2, D3][h % 3]), SR, 1.2, { seed: h + 3, brightness: 0.05, velocity: 0.4 });
      const s = Math.round(t * SR);
      for (let k = 0; k < note.length && s + k < dull.length; k++) dull[s + k] += note[k];
    });
    const r1 = compare(times, detectOnsets(dull, SR));
    expect(r1.missed).toBe(0);
    expect(r1.extra).toBe(0);
    expect(r1.worst).toBeLessThan(10);

    // Sentez tel değil: 4 ms'de yükselen, sönümlü, 200–400 Hz'lik "tok" vuruşlar.
    const soft = new Float32Array(Math.round(5 * SR));
    times.forEach((t, h) => {
      const s = Math.round(t * SR);
      const f = 200 + (h % 3) * 100;
      for (let k = 0; k < SR * 0.25; k++) {
        const sec = k / SR;
        const env = Math.min(1, sec / 0.004) * Math.exp(-sec / 0.06);
        soft[s + k] += 0.4 * env * (Math.sin(2 * Math.PI * f * sec) + 0.4 * Math.sin(2 * Math.PI * f * 2.7 * sec));
      }
    });
    const r2 = compare(times, detectOnsets(soft, SR));
    expect(r2.missed).toBe(0);
    expect(r2.extra).toBe(0);
    expect(r2.worst).toBeLessThan(10);
    report.push(`boğuk tel: en kötü ${r1.worst.toFixed(2)} ms · yumuşak atak: en kötü ${r2.worst.toFixed(2)} ms`);
  });

  it('sessizlikte, sabit gürültüde ve tek bir uzun çınlamada sahte vuruş yok', () => {
    expect(detectOnsets(new Float32Array(SR * 2), SR)).toEqual([]);
    const rand = mulberry32(9);
    const noise = Float32Array.from({ length: SR * 3 }, () => (rand() * 2 - 1) * 0.05);
    // Gürültünün başladığı an dışında vuruş yok.
    expect(detectOnsets(noise, SR).filter((s) => s > SR * 0.1)).toEqual([]);
    const ring = render([{ time: 0.2, midis: EM, spread: 0.012, decay: 6 }], 4);
    expect(detectOnsets(ring, SR)).toHaveLength(1);
  });

  it('özet', () => {
    console.log('[vuruş] ' + report.join(' · '));
    expect(report.length).toBeGreaterThanOrEqual(6);
  });
});
