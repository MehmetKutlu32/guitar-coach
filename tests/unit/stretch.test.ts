import { describe, expect, it } from 'vitest';
import { mulberry32, pluck, rmsOf, sine } from '../../src/audio/synth/karplus';
import { centsBetween } from '../../src/dsp/notes';
import { detectOnsets } from '../../src/dsp/onset';
import { findTransients, semitonesToRatio, stretchAll, TimeStretcher } from '../../src/dsp/stretch';
import { PitchDetector } from '../../src/dsp/yin';

const SR = 44100;

/** Sinyalin ortasındaki birkaç noktada perdeyi ölçer; beklenen frekansa göre en büyük sapmayı (cent) döndürür. */
function worstCents(signal: Float32Array, expected: number, sampleRate = SR): number {
  const size = 4096;
  const det = new PitchDetector(sampleRate, { bufferSize: size });
  let worst = 0;
  for (const f of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    const from = Math.floor(signal.length * f);
    if (from + size > signal.length) continue;
    const r = det.detect(signal.subarray(from, from + size));
    expect(r.freq).toBeGreaterThan(0);
    worst = Math.max(worst, Math.abs(centsBetween(r.freq, expected)));
  }
  return worst;
}

/** Genliğin zaman içindeki dalgalanması: 50 ms'lik parçaların RMS'inin en küçük / en büyük oranı. */
function steadiness(signal: Float32Array, sampleRate = SR): number {
  const win = Math.floor(0.05 * sampleRate);
  let min = Infinity;
  let max = 0;
  for (let from = Math.floor(signal.length * 0.1); from + win < signal.length * 0.9; from += win) {
    const r = rmsOf(signal, from, from + win);
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  return min / max;
}

/** Art arda çalınmış, çınlamaya devam eden notalardan oluşan dizi (vuruş zamanları bilinir). */
function pluckSequence(freqs: number[], gap: number): { signal: Float32Array; times: number[] } {
  const total = Math.floor((freqs.length * gap + 1.5) * SR);
  const signal = new Float32Array(total);
  const times: number[] = [];
  freqs.forEach((f, i) => {
    const at = 0.1 + i * gap;
    times.push(at);
    const note = pluck(f, SR, 1.2);
    const start = Math.floor(at * SR);
    for (let k = 0; k < note.length && start + k < total; k++) signal[start + k] += note[k] * 0.5;
  });
  return { signal, times };
}

describe('zaman esnetme (WSOLA)', () => {
  it('hız 1, ton 0: sinyal değişmeden geçer', () => {
    const input = sine(330, SR, 1, 0.5);
    const out = stretchAll(input, SR, 1, 0);
    expect(out).toHaveLength(input.length);
    // İlk pencere yarısı açılış geçişidir; sonrası girişle örnek örnek aynıdır.
    let worst = 0;
    for (let i = 4096; i < input.length - 4096; i++) worst = Math.max(worst, Math.abs(out[i] - input[i]));
    expect(worst).toBeLessThan(1e-5);
  });

  it('yavaşlatma ve hızlandırma perdeyi korur, süreyi değiştirir (sinüs)', () => {
    const report: string[] = [];
    for (const speed of [0.5, 0.6, 0.75, 0.9, 1.25, 1.5]) {
      let worst = 0;
      let steady = 1;
      for (const freq of [82.41, 110, 196, 329.63, 440, 880]) {
        const input = sine(freq, SR, 2, 0.5);
        const out = stretchAll(input, SR, speed);
        expect(out.length).toBe(Math.ceil(input.length / speed));
        worst = Math.max(worst, worstCents(out, freq));
        steady = Math.min(steady, steadiness(out));
        // Seviye korunur.
        expect(rmsOf(out, Math.floor(out.length * 0.2), Math.floor(out.length * 0.8))).toBeCloseTo(0.5 / Math.SQRT2, 1);
      }
      report.push(`×${speed}: ${worst.toFixed(2)} cent, genlik kararlılığı ${steady.toFixed(3)}`);
      expect(worst).toBeLessThan(5);
      expect(steady).toBeGreaterThan(0.9);
    }
    console.log(`[esnetme] sinüs, en kötü perde sapması → ${report.join('; ')}`);
  });

  it('tel sesinde (Karplus-Strong) yarı hızda perde korunur', () => {
    let worst = 0;
    for (const freq of [110, 146.83, 246.94, 329.63]) {
      const input = pluck(freq, SR, 2);
      const out = stretchAll(input, SR, 0.5);
      // Çıkışın ilk yarısı = girişin ilk saniyesi (tel hâlâ güçlüyken ölç).
      const det = new PitchDetector(SR, { bufferSize: 4096 });
      const a = det.detect(input.subarray(Math.floor(0.5 * SR), Math.floor(0.5 * SR) + 4096)).freq;
      const b = det.detect(out.subarray(Math.floor(1.0 * SR), Math.floor(1.0 * SR) + 4096)).freq;
      worst = Math.max(worst, Math.abs(centsBetween(b, a)));
    }
    console.log(`[esnetme] Karplus-Strong ×0.5: özgün sese göre en kötü perde sapması ${worst.toFixed(2)} cent`);
    expect(worst).toBeLessThan(5);
  });

  it('ton değiştirme süreyi korur, perdeyi istenen kadar kaydırır', () => {
    const report: string[] = [];
    for (const semis of [-12, -5, -2, -1, 1, 2, 3, 7, 12]) {
      const freq = 220;
      const input = sine(freq, SR, 2, 0.5);
      const out = stretchAll(input, SR, 1, semis);
      expect(out.length).toBe(input.length);
      const worst = worstCents(out, freq * semitonesToRatio(semis));
      report.push(`${semis > 0 ? '+' : ''}${semis}: ${worst.toFixed(2)}`);
      expect(worst).toBeLessThan(5);
      expect(steadiness(out)).toBeGreaterThan(0.85);
    }
    console.log(`[esnetme] ton değiştirme, sapma (cent) → ${report.join('; ')}`);
  });

  it('hız ve ton birlikte: yarı hız + 3 yarım ton pes', () => {
    const input = sine(440, SR, 2, 0.5);
    const out = stretchAll(input, SR, 0.5, -3);
    expect(out.length).toBe(input.length * 2);
    expect(worstCents(out, 440 * semitonesToRatio(-3))).toBeLessThan(5);
  });

  it('vuruş zamanları hızla orantılı kayar (ritim korunur)', () => {
    const { signal, times } = pluckSequence([196, 246.94, 293.66, 392, 329.63, 246.94], 0.4);
    const report: string[] = [];
    for (const speed of [0.5, 0.75, 1.25]) {
      const out = stretchAll(signal, SR, speed);
      // detectOnsets örnek konumu döndürür.
      const onsets = detectOnsets(out, SR).map((n) => n / SR);
      expect(onsets.length).toBe(times.length);
      let worst = 0;
      onsets.forEach((t, i) => {
        // Aralıklar özgün aralıkların 1/hız katı olmalı (sabit gecikme önemsiz).
        const expected = (times[i] - times[0]) / speed;
        worst = Math.max(worst, Math.abs(t - onsets[0] - expected) * 1000);
      });
      report.push(`×${speed}: ${worst.toFixed(1)} ms`);
      expect(worst).toBeLessThan(30);
    }
    console.log(`[esnetme] vuruş aralıklarında en büyük sapma → ${report.join('; ')}`);
  });
});

describe('vuruş koruma', () => {
  /** Kısık bir ton üzerinde kısa gürültü patlamaları (davul vuruşu gibi). */
  function clicks(): { signal: Float32Array; at: number[] } {
    const signal = sine(110, SR, 2.2, 0.01);
    const random = mulberry32(3);
    const at = [0.3, 0.7, 1.1, 1.5, 1.9];
    for (const t of at) {
      const start = Math.floor(t * SR);
      for (let i = 0; i < 0.004 * SR; i++) signal[start + i] += (random() * 2 - 1) * 0.8 * Math.exp(-i / (0.001 * SR));
    }
    return { signal, at };
  }

  /** Her vuruş için: en güçlü 15 ms'lik bölümün, çevresindeki ±100 ms'lik enerjiye oranı (1 = tek, derli toplu vuruş). */
  function compactness(out: Float32Array, at: number[], speed: number): number {
    const step = Math.floor(0.0025 * SR);
    const span = 6 * step;
    let worst = 1;
    for (const t of at) {
      const center = Math.floor((t / speed) * SR);
      const from = Math.max(0, center - Math.floor(0.1 * SR));
      const to = Math.min(out.length, center + Math.floor(0.1 * SR));
      let total = 0;
      for (let i = from; i < to; i++) total += out[i] * out[i];
      let best = 0;
      for (let s = from; s + span <= to; s += step) {
        let e = 0;
        for (let i = s; i < s + span; i++) e += out[i] * out[i];
        best = Math.max(best, e);
      }
      worst = Math.min(worst, total > 0 ? best / total : 0);
    }
    return worst;
  }

  it('girişteki vuruşları bulur; durağan tonda ve vuruşan iki notada yanlış alarm vermez', () => {
    const { signal, at } = clicks();
    const found = findTransients(signal, SR);
    expect(found).toHaveLength(at.length);
    found.forEach((n, i) => expect(Math.abs(n / SR - at[i]) * 1000).toBeLessThan(8));
    expect(findTransients(sine(82.41, SR, 2, 0.5), SR)).toEqual([]);
    // 196 Hz + 220 Hz: 24 Hz'lik vuruşma (genlik dalgalanması) vuruş sayılmaz.
    const beat = sine(196, SR, 2, 0.4);
    const other = sine(220, SR, 2, 0.4);
    for (let i = 0; i < beat.length; i++) beat[i] += other[i];
    expect(findTransients(beat, SR)).toEqual([]);
    expect(findTransients(new Float32Array(100), SR)).toEqual([]);
    // Çalınmış notaların atakları bulunur.
    const { signal: notes, times } = pluckSequence([196, 246.94, 293.66, 392], 0.4);
    const attacks = findTransients(notes, SR);
    expect(attacks).toHaveLength(times.length);
    attacks.forEach((n, i) => expect(Math.abs(n / SR - times[i]) * 1000).toBeLessThan(10));
  });

  it('yavaşlatmada vuruşlar çiftlenmez: koruma açıkken her vuruş tek ve derli toplu kalır', () => {
    const { signal, at } = clicks();
    const report: string[] = [];
    for (const speed of [0.5, 0.75]) {
      const on = compactness(stretchAll(signal, SR, speed), at, speed);
      const off = compactness(stretchAll(signal, SR, speed, 0, { transients: [] }), at, speed);
      report.push(`×${speed}: korumalı ${on.toFixed(2)}, korumasız ${off.toFixed(2)}`);
      expect(on).toBeGreaterThan(0.9);
      expect(on).toBeGreaterThan(off);
    }
    console.log(`[esnetme] vuruş derli topluluğu (1 = tek vuruş) → ${report.join('; ')}`);
  });
});

describe('akış: konum, döngü, bitiş', () => {
  it('konum çalma hızıyla ilerler ve sona gelince biter', () => {
    const input = sine(220, SR, 2, 0.5);
    const st = new TimeStretcher(input, SR);
    st.setSpeed(0.5);
    const block = new Float32Array(128);
    // 1 saniyelik çıkış = yarım saniyelik giriş.
    for (let n = 0; n < SR; n += 128) st.process(block);
    expect(st.position / SR).toBeGreaterThan(0.45);
    expect(st.position / SR).toBeLessThan(0.55);
    expect(st.ended).toBe(false);
    let guard = 0;
    while (!st.ended && guard++ < 10_000) st.process(block);
    expect(st.ended).toBe(true);
    // Toplam çıkış ≈ giriş / hız.
    expect((SR / 128 + guard) * 128).toBeGreaterThan(input.length * 2 * 0.98);
    expect((SR / 128 + guard) * 128).toBeLessThan(input.length * 2 * 1.05);
    // Bittikten sonra sessizlik üretir.
    st.process(block);
    expect(rmsOf(block)).toBeLessThan(1e-4);
  });

  it('konum değiştirme (seek) o noktadan devam eder', () => {
    // İlk saniye 220 Hz, ikinci saniye 440 Hz.
    const input = new Float32Array(2 * SR);
    input.set(sine(220, SR, 1, 0.5), 0);
    input.set(sine(440, SR, 1, 0.5), SR);
    const st = new TimeStretcher(input, SR);
    st.setSpeed(0.75);
    st.seek(1.2 * SR);
    const out = new Float32Array(8192);
    st.process(out);
    const freq = new PitchDetector(SR, { bufferSize: 4096 }).detect(out.subarray(4096)).freq;
    expect(Math.abs(centsBetween(freq, 440))).toBeLessThan(5);
    expect(st.position / SR).toBeGreaterThan(1.2);
  });

  it('A–B döngüsü: konum aralıkta kalır, ses kesilmez, döngü dışındaki bölüm duyulmaz', () => {
    // 0–1 sn 220 Hz, 1–2 sn 330 Hz, 2–3 sn 440 Hz.
    const input = new Float32Array(3 * SR);
    input.set(sine(220, SR, 1, 0.5), 0);
    input.set(sine(330, SR, 1, 0.5), SR);
    input.set(sine(440, SR, 1, 0.5), 2 * SR);
    const st = new TimeStretcher(input, SR);
    st.setSpeed(0.8);
    st.setLoop(1.1 * SR, 1.9 * SR);
    st.seek(1.1 * SR);
    const det = new PitchDetector(SR, { bufferSize: 4096 });
    const block = new Float32Array(4096);
    let quietest = Infinity;
    for (let i = 0; i < 60; i++) {
      // 60 × 93 ms ≈ 5,6 sn çıkış: döngü birkaç kez döner.
      st.process(block);
      const p = st.position / SR;
      expect(p).toBeGreaterThanOrEqual(1.1 - 0.001);
      expect(p).toBeLessThanOrEqual(1.9 + 0.001);
      if (i > 0) {
        quietest = Math.min(quietest, rmsOf(block));
        expect(Math.abs(centsBetween(det.detect(block).freq, 330))).toBeLessThan(15);
      }
    }
    expect(quietest).toBeGreaterThan(0.25);
    expect(st.ended).toBe(false);
    // Döngü kaldırılınca parça sonuna kadar devam eder.
    st.setLoop(null, null);
    let guard = 0;
    while (!st.ended && guard++ < 2000) st.process(block);
    expect(st.ended).toBe(true);
  });

  it('çalarken hız ve ton değişince ses sürer; sınır dışı değerler kırpılır', () => {
    const input = sine(220, SR, 4, 0.5);
    const st = new TimeStretcher(input, SR);
    const block = new Float32Array(4096);
    const det = new PitchDetector(SR, { bufferSize: 4096 });
    st.process(block);
    st.setSpeed(0.5);
    st.setSemitones(2);
    for (let i = 0; i < 4; i++) st.process(block);
    expect(rmsOf(block)).toBeGreaterThan(0.3);
    expect(Math.abs(centsBetween(det.detect(block).freq, 220 * semitonesToRatio(2)))).toBeLessThan(5);
    st.setSpeed(100);
    st.setSemitones(-99);
    for (let i = 0; i < 4; i++) st.process(block);
    expect(Math.abs(centsBetween(det.detect(block).freq, 110))).toBeLessThan(5);
    // Çok kısa döngü yok sayılır.
    st.setLoop(1000, 1100);
    st.seek(0);
    for (let i = 0; i < 4; i++) st.process(block);
    expect(st.position).toBeGreaterThan(1100);
  });
});

describe('başarım', () => {
  it('gerçek zamandan çok daha hızlı çalışır (AudioWorklet içinde kullanılabilir)', () => {
    // Zor durum: çok sesli, vuruşlu sinyal; yarı hız ve en pes ton (pencere başına en çok arama).
    const input = new Float32Array(6 * SR);
    [110, 164.81, 220, 277.18].forEach((f, k) => {
      for (let n = 0; n < 6; n++) {
        const note = pluck(f, SR, 1);
        const start = Math.floor((n + k * 0.25) * SR);
        for (let i = 0; i < note.length && start + i < input.length; i++) input[start + i] += note[i] * 0.3;
      }
    });
    const report: string[] = [];
    for (const [speed, semis] of [[0.5, 0], [0.5, 12], [1, -12], [2, 12]] as const) {
      const started = performance.now();
      const out = stretchAll(input, SR, speed, semis);
      const ms = performance.now() - started;
      const realtime = (out.length / SR) * 1000;
      report.push(`×${speed} ${semis >= 0 ? '+' : ''}${semis}: ${(realtime / ms).toFixed(0)}×`);
      expect(realtime / ms).toBeGreaterThan(8);
    }
    console.log(`[esnetme] işlem hızı (gerçek zamanın katı) → ${report.join('; ')}`);
  });
});
