import { describe, expect, it } from 'vitest';
import { pluck } from '../../src/audio/synth/karplus';
import { FFT } from '../../src/dsp/fft';
import {
  analyzeGuardFrame,
  applyCurve,
  blockRmsDb,
  dbToGain,
  delaySeconds,
  driveAmount,
  driveCurve,
  driveLevelGain,
  echoLevel,
  faderGain,
  FeedbackDelay,
  feedbackGain,
  HowlGuard,
  NoiseGate,
  reverbImpulse,
  reverbPreDelay,
  safetyCurve,
  toneHz,
  type GuardVerdict,
} from '../../src/dsp/fx';
import {
  BUILTIN_PRESETS,
  DEFAULT_PRESET,
  estimateLatency,
  isUserPreset,
  latencyRating,
  presetName,
  samePreset,
  sanitizeInput,
  sanitizePreset,
} from '../../src/features/fx/logic';

const SR = 48000;
const N = 8192;
/** FFT kutusuna tam oturan frekans (sızıntısız harmonik ölçümü için). */
const BIN = 38;
const F0 = (BIN * SR) / N; // ≈ 222,7 Hz

function sine(amp: number, freq = F0, n = N, sr = SR): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

/** Harmonik bozulma: 2.–15. harmoniklerin gücünün temel frekansın gücüne oranının karekökü. */
function thd(x: Float32Array): number {
  const re = Float64Array.from(x);
  const im = new Float64Array(x.length);
  new FFT(x.length).forward(re, im);
  const p = (k: number) => re[k] * re[k] + im[k] * im[k];
  let h = 0;
  for (let m = 2; m <= 15; m++) h += p(BIN * m);
  return Math.sqrt(h / p(BIN));
}

function shape(x: Float32Array, curve: Float32Array): Float32Array {
  return x.map((v) => applyCurve(curve, v));
}

function rms(x: ArrayLike<number>, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

describe('overdrive eğrisi', () => {
  it('sınırlı, tek simetrili ve tekdüze artan', () => {
    for (const drive of [0, 10, 45, 78, 100]) {
      const c = driveCurve(drive);
      const n = c.length;
      expect(c[0]).toBeCloseTo(-1, 6);
      expect(c[n - 1]).toBeCloseTo(1, 6);
      for (let i = 0; i < n; i++) {
        expect(Math.abs(c[i])).toBeLessThanOrEqual(1 + 1e-6);
        expect(c[i] + c[n - 1 - i]).toBeCloseTo(0, 6);
        if (i > 0) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
      }
    }
  });

  it('drive 0 doğrusal: sinyali değiştirmez', () => {
    expect(driveAmount(0)).toBe(0);
    const x = sine(0.6);
    const y = shape(x, driveCurve(0));
    let maxErr = 0;
    for (let i = 0; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(y[i] - x[i]));
    expect(maxErr).toBeLessThan(1e-6);
    expect(thd(y)).toBeLessThan(1e-4);
  });

  it('harmonik ekler; drive arttıkça bozulma artar, çıkış hiçbir zaman 1’i aşmaz', () => {
    const x = sine(0.4);
    const values = [0, 20, 45, 78, 100].map((d) => thd(shape(x, driveCurve(d))));
    console.log(`[overdrive] THD (drive 0/20/45/78/100): ${values.map((v) => (v * 100).toFixed(1) + '%').join(' / ')}`);
    expect(values[0]).toBeLessThan(0.001);
    expect(values[2]).toBeGreaterThan(0.1);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    // Aşırı giriş (×4) bile sınırlı kalır.
    const hot = shape(sine(4), driveCurve(100));
    expect(Math.max(...hot.map(Math.abs))).toBeLessThanOrEqual(1);
  });

  it('yalnızca tek harmonikler (simetrik kırpma)', () => {
    const y = shape(sine(0.4), driveCurve(60));
    const re = Float64Array.from(y);
    const im = new Float64Array(y.length);
    new FFT(y.length).forward(re, im);
    const mag = (k: number) => Math.hypot(re[k], im[k]);
    expect(mag(BIN * 3) / mag(BIN)).toBeGreaterThan(0.05);
    expect(mag(BIN * 2) / mag(BIN)).toBeLessThan(1e-4);
  });

  it('seviye dengeleme: drive 20–100 arasında çıkış seviyesi 10 dB içinde kalır', () => {
    const x = sine(0.3);
    const levels = [20, 45, 78, 100].map((d) => 20 * Math.log10(rms(shape(x, driveCurve(d))) * driveLevelGain(85, d)));
    console.log(`[overdrive] çıkış seviyesi dBFS (drive 20/45/78/100, seviye 85): ${levels.map((v) => v.toFixed(1)).join(' / ')}`);
    expect(Math.max(...levels) - Math.min(...levels)).toBeLessThan(10);
  });

  it('ton ve ses düğmesi eşlemeleri', () => {
    expect(toneHz(0)).toBeCloseTo(700, 6);
    expect(toneHz(100)).toBeCloseTo(11200, 6);
    expect(toneHz(50)).toBeCloseTo(2800, 6);
    expect(toneHz(-5)).toBe(toneHz(0));
    expect(faderGain(0)).toBe(0);
    expect(faderGain(100)).toBeCloseTo(1, 9);
    expect(faderGain(50)).toBeCloseTo(dbToGain(-20), 9);
    expect(faderGain(100, 6)).toBeCloseTo(dbToGain(6), 9);
  });
});

describe('güvenlik kırpıcısı', () => {
  const c = safetyCurve(4, 0.8);
  it('0,8’e kadar birebir (efekt sesine dokunmaz)', () => {
    for (let x = -0.8; x <= 0.8; x += 0.01) expect(applyCurve(c, x / 4)).toBeCloseTo(x, 5);
  });
  it('aşırı seviyeyi 1’in altında tutar, tekdüze', () => {
    for (const x of [0.9, 1, 2, 4, 10]) {
      const y = applyCurve(c, x / 4);
      expect(y).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThan(0.8);
    }
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
  });
});

describe('delay', () => {
  it('tempoya bağlı süre metronomdan hesaplanır', () => {
    expect(delaySeconds({ timeMs: 300, sync: true, division: '1/4' }, 60)).toBeCloseTo(1, 9);
    expect(delaySeconds({ timeMs: 300, sync: true, division: '1/8.' }, 120)).toBeCloseTo(0.375, 9);
    expect(delaySeconds({ timeMs: 300, sync: true, division: '1/8' }, 90)).toBeCloseTo(1 / 3, 9);
    expect(delaySeconds({ timeMs: 300, sync: true, division: '1/8t' }, 100)).toBeCloseTo(0.2, 9);
    expect(delaySeconds({ timeMs: 300, sync: true, division: '1/16' }, 150)).toBeCloseTo(0.1, 9);
    // Çok yavaş tempoda üst sınır.
    expect(delaySeconds({ timeMs: 300, sync: true, division: '1/4' }, 30)).toBe(1.5);
  });

  /** Dürtüyü 128'lik bloklarla (worklet gibi) işler. */
  function delayImpulse(seconds: number, feedback: number, mix: number, total: number, sr = SR): Float32Array {
    const d = new FeedbackDelay(sr);
    d.set(seconds, feedback, mix);
    const x = new Float32Array(total);
    x[0] = 0.5;
    const y = new Float32Array(total);
    for (let i = 0; i < total; i += 128) d.process(x.subarray(i, i + 128), y.subarray(i, i + 128));
    return y;
  }

  it.each([
    [0.25, 48000],
    [0.375, 48000],
    [0.1234, 44100],
  ])('yankılar %s s aralıkla, örnek hassasiyetinde (%s Hz)', (seconds, sr) => {
    const y = delayImpulse(seconds, 0.5, 0.5, Math.round(sr * seconds * 4.5), sr);
    expect(y[0]).toBe(0.5);
    const peaks: number[] = [];
    for (let n = 1; n <= 4; n++) {
      const at = n * seconds * sr;
      let best = Math.floor(at) - 20;
      for (let i = best; i < Math.floor(at) + 20; i++) if (Math.abs(y[i]) > Math.abs(y[best])) best = i;
      peaks.push(best);
      // ±1 ms; ilk iki yankı tam sayı örnekte birebir (sonrakilerde koyulaştırma süzgeci tepeyi 1 örnek kaydırır).
      expect(Math.abs(best - at) / sr).toBeLessThanOrEqual(0.001);
      if (Number.isInteger(at) && n <= 2) expect(best).toBe(at);
    }
    // İlk yankı: kuru × mix. Sonrakiler geri beslemeyle azalır.
    expect(y[peaks[0]]).toBeCloseTo(0.25, Number.isInteger(seconds * sr) ? 9 : 1);
    for (let n = 1; n < 4; n++) expect(Math.abs(y[peaks[n]])).toBeLessThan(Math.abs(y[peaks[n - 1]]));
  });

  it('karışım 0 iken birebir geçer; geri besleme %90’da bile söner', () => {
    const d = new FeedbackDelay(SR);
    d.set(0.2, 0.9, 0);
    const x = sine(0.4, 220, SR);
    const y = new Float32Array(x.length);
    d.process(x, y);
    expect(y).toEqual(x);
    const tail = delayImpulse(0.05, 0.9, 1, SR * 6);
    const early = rms(tail, 0, SR);
    const late = rms(tail, SR * 5, SR * 6);
    expect(late).toBeLessThan(early * 0.01);
    expect(tail.every(Number.isFinite)).toBe(true);
  });

  it('süre değişince okuma noktası yumuşakça kayar (sıçrama yok)', () => {
    const d = new FeedbackDelay(SR);
    d.set(0.1, 0, 1);
    const x = sine(0.5, 220, SR * 2);
    const y = new Float32Array(x.length);
    d.process(x.subarray(0, SR), y.subarray(0, SR));
    d.set(0.4, 0, 1);
    d.process(x.subarray(SR), y.subarray(SR));
    let maxStep = 0;
    for (let i = SR + 1; i < x.length; i++) maxStep = Math.max(maxStep, Math.abs(y[i] - y[i - 1]));
    // 220 Hz, toplam genlik ≤ 1: örnek başına en fazla ~0,03 değişir; sıçrama olsaydı çok daha büyük olurdu.
    expect(maxStep).toBeLessThan(0.06);
  });

  it('elle süre sınırlanır; geri besleme %90’da kesilir', () => {
    expect(delaySeconds({ timeMs: 380, sync: false, division: '1/4' }, 120)).toBeCloseTo(0.38, 9);
    expect(delaySeconds({ timeMs: 5, sync: false, division: '1/4' }, 120)).toBe(0.02);
    expect(delaySeconds({ timeMs: 9000, sync: false, division: '1/4' }, 120)).toBe(1.5);
    expect(feedbackGain(30)).toBeCloseTo(0.3, 9);
    expect(feedbackGain(100)).toBe(0.9);
    expect(echoLevel(1, 40, 50)).toBeCloseTo(0.4, 9);
    expect(echoLevel(3, 40, 50)).toBeCloseTo(0.1, 9);
  });
});

describe('reverb dürtü yanıtı', () => {
  it.each([0.5, 1.6, 4])('T60 = %s s: kuyruk ayarlanan sürede −60 dB’e iner', (decay) => {
    const size = 40;
    const [h] = reverbImpulse(SR, decay, size, 1, 3);
    const pre = Math.round(reverbPreDelay(size) * SR);
    const block = 0.01;
    const levels = blockRmsDb(h.subarray(pre), SR, block);
    // T60 ölçümü (akustikteki gibi): sönüm eğrisine doğru uydur, eğimden 60 dB'lik düşüş süresini bul.
    const pts = levels
      .map((db, b) => ({ t: (b + 0.5) * block, db }))
      .filter((p) => p.t >= 0.05 && p.t <= decay * 0.9);
    const mt = pts.reduce((s, p) => s + p.t, 0) / pts.length;
    const md = pts.reduce((s, p) => s + p.db, 0) / pts.length;
    const slope = pts.reduce((s, p) => s + (p.t - mt) * (p.db - md), 0) / pts.reduce((s, p) => s + (p.t - mt) ** 2, 0);
    const t60 = -60 / slope;
    // Ayrıca: kuyruğun başındaki seviyeden (doğrunun t=0 değeri) 60 dB aşağıya ilk inildiği an.
    const start = md - slope * mt;
    const crossing = (levels.findIndex((db, b) => b > 2 && db <= start - 60) + 0.5) * block;
    console.log(
      `[reverb] T60 ${decay} s → eğimden ${t60.toFixed(3)} s (fark ${(((t60 - decay) / decay) * 100).toFixed(2)}%), ` +
        `−60 dB'e iniş ${crossing.toFixed(3)} s`,
    );
    expect(Math.abs(t60 - decay)).toBeLessThanOrEqual(decay * 0.02);
    expect(Math.abs(crossing - decay)).toBeLessThanOrEqual(decay * 0.05);
  });

  it('ön gecikme, enerji, kanallar arası ilinti ve tekrarlanabilirlik', () => {
    const [l, r] = reverbImpulse(SR, 1.2, 80, 2, 7);
    const pre = Math.round(reverbPreDelay(80) * SR);
    for (let i = 0; i < pre; i++) expect(l[i]).toBe(0);
    expect(Math.abs(l[pre + 200])).toBeGreaterThan(0);
    expect(l.every(Number.isFinite)).toBe(true);
    const energy = (x: Float32Array) => x.reduce((s, v) => s + v * v, 0);
    expect(energy(l)).toBeCloseTo(0.5, 4);
    expect(energy(r)).toBeCloseTo(0.5, 4);
    let lr = 0;
    for (let i = 0; i < l.length; i++) lr += l[i] * r[i];
    expect(Math.abs(lr / Math.sqrt(energy(l) * energy(r)))).toBeLessThan(0.2);
    const [again] = reverbImpulse(SR, 1.2, 80, 2, 7);
    expect(again).toEqual(l);
  });

  it('kuyruk zamanla koyulaşır (tizler önce söner)', () => {
    const [h] = reverbImpulse(SR, 2, 40, 1);
    // Ardışık örnek farkının enerjisi / örnek enerjisi: yüksek frekans payının kaba ölçüsü.
    const hf = (from: number, to: number) => {
      let d = 0;
      let e = 0;
      for (let i = from + 1; i < to; i++) {
        d += (h[i] - h[i - 1]) ** 2;
        e += h[i] ** 2;
      }
      return d / e;
    };
    expect(hf(SR * 0.05, SR * 0.15)).toBeGreaterThan(hf(SR * 1.5, SR * 1.6) * 1.5);
  });
});

describe('gürültü kapısı', () => {
  it('eşiğin altındaki vızıltıyı keser, çalınan sesi geçirir', () => {
    const gate = new NoiseGate(SR, { thresholdDb: -40 });
    const hum = sine(dbToGain(-50), 50, SR);
    const out = new Float32Array(hum.length);
    gate.process(hum, out);
    expect(rms(out)).toBeLessThan(1e-6);
    // Nota: 1 ms içinde açılır, sonrası birebir geçer.
    const note = sine(0.3, 220, SR);
    gate.process(note, out);
    expect(gate.isOpen).toBe(true);
    let maxErr = 0;
    for (let i = Math.round(0.002 * SR); i < out.length; i++) maxErr = Math.max(maxErr, Math.abs(out[i] - note[i]));
    expect(maxErr).toBe(0);
  });

  it('histerezis: eşiğin biraz altına inen sönümlü nota kesilmez; çok altına inince kapanır', () => {
    const gate = new NoiseGate(SR, { thresholdDb: -40, hold: 0.05, release: 0.08 });
    const out = new Float32Array(SR / 2);
    gate.process(sine(0.1, 220, SR / 2), out);
    expect(gate.isOpen).toBe(true);
    // −43 dB: açılma eşiğinin altında, kapanma eşiğinin (−46 dB) üstünde.
    gate.process(sine(dbToGain(-43), 220, SR / 2), out);
    expect(gate.isOpen).toBe(true);
    expect(gate.currentGain).toBe(1);
    gate.process(sine(dbToGain(-60), 220, SR / 2), out);
    expect(gate.isOpen).toBe(false);
    expect(gate.currentGain).toBe(0);
  });
});

/** Sinyali ~50 ms aralıklı 2048'lik çerçevelerle korumaya verir; ilk uyarının zamanını döndürür. */
function runGuard(signal: Float32Array, sr = SR): { verdict: GuardVerdict; at: number } {
  const guard = new HowlGuard();
  const hop = Math.round(0.05 * sr);
  const fft = new FFT(2048);
  for (let end = 2048; end <= signal.length; end += hop) {
    const v = guard.push(analyzeGuardFrame(signal.subarray(end - 2048, end), sr, fft), hop / sr);
    if (v !== 'ok') return { verdict: v, at: end / sr };
  }
  return { verdict: 'ok', at: signal.length / sr };
}

function generate(seconds: number, fn: (t: number, i: number) => number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = fn(i / SR, i);
  return out;
}

describe('geri besleme koruması', () => {
  it('üstel büyüyen tek ton (ıslık) bir saniye içinde yakalanır', () => {
    // 0,005'ten başlayıp saniyede 20 dB büyüyen 1,2 kHz ton.
    const howl = generate(4, (t) => Math.min(0.9, 0.005 * Math.pow(10, t)) * Math.sin(2 * Math.PI * 1200 * t));
    const r = runGuard(howl);
    console.log(`[koruma] büyüyen ton → ${r.verdict}, ${r.at.toFixed(2)} s`);
    expect(r.verdict).toBe('howl');
    expect(r.at).toBeLessThan(2.4);
  });

  it('sürekli kırpılma yarım saniyede yakalanır', () => {
    const square = generate(3, (t) => (Math.sin(2 * Math.PI * 300 * t) >= 0 ? 1.3 : -1.3));
    const r = runGuard(square);
    expect(r.verdict).toBe('clip');
    expect(r.at).toBeGreaterThan(0.5);
    expect(r.at).toBeLessThan(0.75);
  });

  it('sınırlayıcıya dayanmış, sönmeyen yüksek saf ton 4 saniyede yakalanır', () => {
    const r = runGuard(generate(6, (t) => 0.5 * Math.sin(2 * Math.PI * 900 * t)));
    expect(r.verdict).toBe('howl');
    expect(r.at).toBeGreaterThan(3.9);
    expect(r.at).toBeLessThan(4.5);
  });

  it('normal çalma uyarı vermez: tel vuruşları, sürekli orta seviye ton, distortion’lı uzun nota, gürültü, sessizlik', () => {
    const notes = [196, 247, 294, 330, 220, 262];
    const plucks = new Float32Array(SR * 8);
    for (let k = 0; k < 16; k++) {
      const p = pluck(notes[k % notes.length], SR, 1.5);
      const at = Math.round(k * 0.5 * SR);
      for (let i = 0; i < p.length && at + i < plucks.length; i++) plucks[at + i] += 0.8 * p[i];
    }
    expect(runGuard(plucks).verdict).toBe('ok');

    expect(runGuard(generate(10, (t) => 0.2 * Math.sin(2 * Math.PI * 110 * t))).verdict).toBe('ok');

    const curve = driveCurve(85);
    const held = pluck(196, SR, 6);
    const lead = held.map((v) => 0.7 * applyCurve(curve, v));
    const r = runGuard(lead);
    console.log(`[koruma] distortion'lı 6 sn nota → ${r.verdict}`);
    expect(r.verdict).toBe('ok');

    let seed = 1;
    const noise = generate(5, () => {
      seed = (seed * 16807) % 2147483647;
      return 0.5 * ((seed / 2147483647) * 2 - 1);
    });
    expect(runGuard(noise).verdict).toBe('ok');
    expect(runGuard(new Float32Array(SR * 5)).verdict).toBe('ok');
  });

  it('çerçeve analizi: saf tonda tonallık ~1, gürültüde düşük', () => {
    const tone = analyzeGuardFrame(sine(0.5, 1000, 2048), SR);
    expect(tone.tonality).toBeGreaterThan(0.95);
    expect(Math.abs(tone.freq - 1000)).toBeLessThan(SR / 2048);
    expect(tone.rms).toBeCloseTo(0.5 / Math.SQRT2, 2);
    let seed = 3;
    const noise = new Float32Array(2048).map(() => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647) * 2 - 1;
    });
    expect(analyzeGuardFrame(noise, SR).tonality).toBeLessThan(0.1);
  });
});

describe('efekt ayarları ve hazır sesler', () => {
  it('hazır sesler geçerli ve birbirinden farklı', () => {
    for (const b of BUILTIN_PRESETS) expect(samePreset(sanitizePreset(b.preset), b.preset)).toBe(true);
    const ids = new Set(BUILTIN_PRESETS.map((b) => JSON.stringify(b.preset)));
    expect(ids.size).toBe(BUILTIN_PRESETS.length);
  });

  it('bozuk ya da eksik kayıt varsayılanlarla tamamlanır, sınırlar uygulanır', () => {
    const p = sanitizePreset({ drive: { on: true, drive: 250, tone: 'x' }, delay: { division: '1/7', feedback: 99 }, reverb: null });
    expect(p.drive.on).toBe(true);
    expect(p.drive.drive).toBe(100);
    expect(p.drive.tone).toBe(DEFAULT_PRESET.drive.tone);
    expect(p.delay.division).toBe(DEFAULT_PRESET.delay.division);
    expect(p.delay.feedback).toBe(90);
    expect(p.reverb).toEqual(DEFAULT_PRESET.reverb);
    expect(sanitizePreset(undefined)).toEqual(DEFAULT_PRESET);
    expect(sanitizePreset({ reverb: { decay: 2.345 } }).reverb.decay).toBeCloseTo(2.3, 9);
    expect(sanitizeInput({ gainDb: 99, gateDb: -200, gateOn: 'yes' })).toEqual({ gainDb: 18, gateOn: false, gateDb: -80 });
  });

  it('kullanıcı sesi kaydı ve adı', () => {
    expect(presetName('  Benim   sesim  ')).toBe('Benim sesim');
    expect(presetName('x'.repeat(60))).toHaveLength(40);
    expect(isUserPreset({ id: 'a', type: 'fxpreset', name: 'A', preset: DEFAULT_PRESET, date: 1 })).toBe(true);
    expect(isUserPreset({ id: 'a', type: 'song', name: 'A' })).toBe(false);
  });
});

describe('gecikme göstergesi', () => {
  it('tarayıcı değerlerini toplar; giriş bilinmiyorsa işleme arabelleği kadar sayar', () => {
    const e = estimateLatency({ base: 0.01, output: 0.02, input: 0.005, chain: 0, calibratedMs: null });
    expect(e).toMatchObject({ ms: 35, source: 'reported', inputKnown: true, rating: 'high' });
    const u = estimateLatency({ base: 0.003, output: 0.004, input: null, chain: 0.0005, calibratedMs: null });
    expect(u.ms).toBe(11);
    expect(u.inputKnown).toBe(false);
    expect(u.rating).toBe('good');
  });

  it('Ayarlar’da ölçülen değer önceliklidir', () => {
    const e = estimateLatency({ base: 0.01, output: 0.02, input: null, chain: 0, calibratedMs: 18 });
    expect(e).toMatchObject({ ms: 18, source: 'calibrated', reportedMs: 40, rating: 'ok' });
    expect(estimateLatency({ base: 0.01, output: 0, input: null, chain: 0, calibratedMs: 0 }).source).toBe('reported');
  });

  it('derecelendirme sınırları', () => {
    expect(latencyRating(12)).toBe('good');
    expect(latencyRating(13)).toBe('ok');
    expect(latencyRating(25)).toBe('ok');
    expect(latencyRating(26)).toBe('high');
  });
});
