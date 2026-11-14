import { describe, expect, it } from 'vitest';
import { midiToFreq } from '../../src/dsp/notes';
import { evaluatePitch, getTuning, PitchSmoother, TUNINGS, tuningLetters } from '../../src/features/tuner/logic';

const detune = (f: number, cents: number) => f * Math.pow(2, cents / 1200);

describe('akort düzenleri', () => {
  it('standart ve alternatif akortlar doğru notalara sahip', () => {
    expect(tuningLetters(getTuning('standard'))).toBe('E A D G B E');
    expect(tuningLetters(getTuning('dropD'))).toBe('D A D G B E');
    expect(tuningLetters(getTuning('halfDown'))).toBe('Eb Ab Db Gb Bb Eb');
    expect(tuningLetters(getTuning('fullDown'))).toBe('D G C F A D');
    expect(tuningLetters(getTuning('dadgad'))).toBe('D A D G A D');
    expect(tuningLetters(getTuning('openG'))).toBe('D G D G B D');
    expect(getTuning('yok').id).toBe('standard');
    for (const t of TUNINGS) {
      if (t.id === 'chromatic') continue;
      expect(t.notes).toHaveLength(6);
      // Kalından inceye sıralı.
      expect([...t.notes].sort((a, b) => a - b)).toEqual(t.notes);
    }
  });
});

describe('evaluatePitch', () => {
  const std = getTuning('standard');

  it('en yakın teli seçer ve sapmayı cent olarak verir', () => {
    const r = evaluatePitch(detune(midiToFreq(45), -12), std, 440);
    expect(r.stringIndex).toBe(1);
    expect(r.name).toBe('A');
    expect(r.octave).toBe(2);
    expect(r.cents).toBeCloseTo(-12, 5);
  });

  it('her açık tel kendi hedefine eşlenir', () => {
    std.notes.forEach((midi, i) => {
      const r = evaluatePitch(midiToFreq(midi), std, 440);
      expect(r.stringIndex).toBe(i);
      expect(Math.abs(r.cents)).toBeLessThan(1e-6);
    });
  });

  it('kilitli telde hedef değişmez', () => {
    const r = evaluatePitch(midiToFreq(40), std, 440, 1);
    expect(r.stringIndex).toBe(1);
    expect(r.cents).toBeCloseTo(-500, 5);
  });

  it('A4 referansı hesaba katılır', () => {
    const r = evaluatePitch(432, getTuning('chromatic'), 432);
    expect(r.name).toBe('A');
    expect(r.cents).toBeCloseTo(0, 6);
    expect(evaluatePitch(432, getTuning('chromatic'), 440).cents).toBeCloseTo(-31.77, 1);
  });

  it('kromatik modda en yakın notayı verir', () => {
    const r = evaluatePitch(detune(midiToFreq(61), 20), getTuning('chromatic'), 440);
    expect(r.name).toBe('C#');
    expect(r.octave).toBe(4);
    expect(r.stringIndex).toBeNull();
    expect(r.cents).toBeCloseTo(20, 5);
  });

  it('yarım ton düşük akortta bemol adları kullanılır', () => {
    const r = evaluatePitch(midiToFreq(39), getTuning('halfDown'), 440);
    expect(r.name).toBe('Eb');
  });
});

describe('PitchSmoother', () => {
  it('tek karelik sıçramaları yok sayar ve medyanı döndürür', () => {
    const s = new PitchSmoother();
    expect(s.push(110, 0.99, 0.1)).toBeNull();
    expect(s.push(110.2, 0.99, 0.1)).toBeCloseTo(110.1, 5);
    s.push(109.9, 0.99, 0.1);
    s.push(110.1, 0.99, 0.1);
    // Tek kare oktav hatası: tamponu sıfırlar ama tek başına gösterilmez.
    expect(s.push(220, 0.99, 0.1)).toBeNull();
    expect(s.push(110, 0.99, 0.1)).toBeNull();
    expect(s.push(110, 0.99, 0.1)).toBeCloseTo(110, 5);
  });

  it('düşük netlik ya da seviyedeki kareleri atar, kısa süre son değeri tutar', () => {
    const s = new PitchSmoother({ holdFrames: 3 });
    s.push(196, 0.99, 0.1);
    s.push(196, 0.99, 0.1);
    expect(s.push(300, 0.5, 0.1)).toBeCloseTo(196, 5);
    expect(s.push(196, 0.99, 0.0001)).toBeCloseTo(196, 5);
    expect(s.push(0, 0, 0)).toBeCloseTo(196, 5);
    expect(s.push(0, 0, 0)).toBeNull();
  });

  it('nota değişince hemen yeni notaya geçer', () => {
    const s = new PitchSmoother();
    for (let i = 0; i < 7; i++) s.push(110, 0.99, 0.1);
    s.push(146.83, 0.99, 0.1);
    expect(s.push(146.83, 0.99, 0.1)).toBeCloseTo(146.83, 5);
  });
});
