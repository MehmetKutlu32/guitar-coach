import { describe, expect, it } from 'vitest';
import { addNoise, pluck, rmsOf, sine } from '../../src/audio/synth/karplus';
import { ChromaExtractor } from '../../src/dsp/chroma';
import { midiToFreq } from '../../src/dsp/notes';
import { BARRE_CHORDS, OPEN_CHORDS, POWER_CHORDS, primaryShape, shapeNotes, type ChordShape } from '../../src/music/chords';
import {
  chordSimilarity,
  chordTemplate,
  isChordPlayed,
  pickTarget,
  recognizeChord,
  TransitionCounter,
} from '../../src/music/recognize';

const SR = 48000;
const extractor = new ChromaExtractor(SR);

type Style = 'down' | 'up' | 'arpeggio';

interface Variant {
  style: Style;
  /** A4 frekansı: 440 dışındaki değerler tüm gitarın hafif akortsuz olduğu durumu verir. */
  a4?: number;
  /** Tel başına rastgele akortsuzluk (cent). */
  jitter?: number;
  snr?: number;
  brightness?: number;
  /** Vuruştan ne kadar sonra dinlendiği (sn). */
  at?: number;
  seed?: number;
}

/** Bir akor biçimini sentez gitar sesiyle çalar. */
function strum(shape: ChordShape, v: Variant): Float32Array {
  const notes = shapeNotes(shape);
  const order = v.style === 'up' ? [...notes].reverse() : notes;
  const spread = v.style === 'arpeggio' ? 0.07 : 0.014;
  const out = new Float32Array(Math.round(SR * 1.6));
  let s = (v.seed ?? 1) * 7919;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  order.forEach((midi, i) => {
    const cents = (v.jitter ?? 0) * (rnd() * 2 - 1);
    const freq = midiToFreq(midi, v.a4 ?? 440) * Math.pow(2, cents / 1200);
    const note = pluck(freq, SR, 1.5, { seed: midi * 13 + i + (v.seed ?? 1), brightness: v.brightness ?? 0.6, velocity: 0.4 });
    const start = Math.round(i * spread * SR);
    for (let k = 0; k < note.length && start + k < out.length; k++) out[start + k] += note[k];
  });
  if (v.snr !== undefined) {
    const level = rmsOf(out, Math.round(0.3 * SR), Math.round(0.6 * SR));
    return addNoise(out, level / Math.pow(10, v.snr / 20), (v.seed ?? 1) + 3);
  }
  return out;
}

function analyze(shape: ChordShape, v: Variant) {
  const sig = strum(shape, v);
  const start = Math.round((v.at ?? 0.5) * SR);
  return extractor.compute(sig.subarray(start, start + extractor.frameSize));
}

/** Akor biçimlerinin tanınma oranı. */
function accuracy(shapes: ChordShape[], variants: Variant[]) {
  let ok = 0;
  let total = 0;
  const wrong: string[] = [];
  for (const shape of shapes) {
    for (const v of variants) {
      const f = analyze(shape, v);
      const guess = recognizeChord(f.chroma, f.bass);
      total++;
      if (guess?.symbol === shape.symbol) ok++;
      else wrong.push(`${shape.id}→${guess?.symbol}`);
    }
  }
  return { ok, total, pct: (100 * ok) / total, wrong };
}

/** Bare akorlardan dengeli bir örneklem: iki biçim, tüm türler, alçak–yüksek perdeler. */
const BARRE_SAMPLE = BARRE_CHORDS.filter((s) => {
  const fret = Math.min(...s.frets.filter((f) => f > 0));
  return [1, 3, 5, 7].includes(fret);
});

const report: string[] = [];

describe('kroma', () => {
  it('tek notada doğru perde sınıfı baskın; sessizlikte boş', () => {
    for (const midi of [40, 45, 52, 57, 64, 69, 76]) {
      const f = extractor.compute(sine(midiToFreq(midi), SR, 0.5, 0.3));
      let best = 0;
      for (let i = 1; i < 12; i++) if (f.chroma[i] > f.chroma[best]) best = i;
      expect(best, `midi ${midi}`).toBe(midi % 12);
      // Bas yalnızca 400 Hz altında aranır.
      if (midi <= 64) expect(f.bass).toBe(midi % 12);
    }
    const silent = extractor.compute(new Float32Array(extractor.frameSize));
    expect(Array.from(silent.chroma).every((v) => v === 0)).toBe(true);
    expect(silent.bass).toBe(-1);
    expect(recognizeChord(silent.chroma, silent.bass)).toBeNull();
  });

  it('±20 cent akortsuzlukta perde sınıfı değişmez', () => {
    for (const cents of [-20, 20]) {
      const f = extractor.compute(sine(midiToFreq(57) * Math.pow(2, cents / 1200), SR, 0.5, 0.3));
      expect(f.chroma[9]).toBe(1);
      expect(f.chroma[8]).toBeLessThan(0.35);
      expect(f.chroma[10]).toBeLessThan(0.35);
    }
  });
});

describe('akor tanıma doğruluğu (sentez gitar) — hedef: temiz sinyalde %90+', () => {
  it('açık akorlar, temiz sinyal: aşağı vuruş, yukarı vuruş, arpej', () => {
    const r = accuracy(OPEN_CHORDS, [{ style: 'down' }, { style: 'up' }, { style: 'arpeggio', at: 0.7 }]);
    report.push(`açık/temiz %${r.pct.toFixed(1)} (${r.ok}/${r.total})`);
    if (r.wrong.length) console.log('[akor] açık/temiz hatalar: ' + r.wrong.join(', '));
    expect(r.pct).toBeGreaterThanOrEqual(90);
  });

  it('bare akorlar, temiz sinyal', () => {
    const r = accuracy(BARRE_SAMPLE, [{ style: 'down' }, { style: 'up' }]);
    report.push(`bare/temiz %${r.pct.toFixed(1)} (${r.ok}/${r.total})`);
    if (r.wrong.length) console.log('[akor] bare/temiz hatalar: ' + r.wrong.join(', '));
    expect(r.pct).toBeGreaterThanOrEqual(90);
  });

  it('power akorlar, temiz sinyal', () => {
    const r = accuracy(POWER_CHORDS, [{ style: 'down' }]);
    report.push(`power/temiz %${r.pct.toFixed(1)} (${r.ok}/${r.total})`);
    if (r.wrong.length) console.log('[akor] power/temiz hatalar: ' + r.wrong.join(', '));
    expect(r.pct).toBeGreaterThanOrEqual(90);
  });

  it('zorlaştırılmış koşullar: akortsuzluk, gürültü, boğuk/parlak ton, erken dinleme', () => {
    const all = [...OPEN_CHORDS, ...BARRE_SAMPLE];
    const conditions: [string, Variant[]][] = [
      ['tüm gitar −12 cent', [{ style: 'down', a4: 440 * Math.pow(2, -12 / 1200) }]],
      ['tüm gitar +12 cent', [{ style: 'down', a4: 440 * Math.pow(2, 12 / 1200) }]],
      ['tel başına ±8 cent', [{ style: 'down', jitter: 8, seed: 2 }, { style: 'up', jitter: 8, seed: 5 }]],
      ['gürültü SNR 20 dB', [{ style: 'down', snr: 20 }]],
      ['gürültü SNR 10 dB', [{ style: 'down', snr: 10 }]],
      ['boğuk ton', [{ style: 'down', brightness: 0.1 }]],
      ['parlak ton', [{ style: 'down', brightness: 1 }]],
      ['vuruştan 0,2 sn sonra', [{ style: 'down', at: 0.2 }]],
      ['vuruştan 1,2 sn sonra (sönerken)', [{ style: 'down', at: 1.2 }]],
    ];
    for (const [name, variants] of conditions) {
      const r = accuracy(all, variants);
      report.push(`${name} %${r.pct.toFixed(1)}`);
      // Zor koşullarda hedef daha düşük; değerler PROGRESS.md'ye yazılır.
      expect(r.pct, name).toBeGreaterThanOrEqual(80);
    }
  });

  it('özet', () => {
    console.log('[akor] tanıma doğruluğu → ' + report.join(' · '));
    expect(report.length).toBeGreaterThan(10);
  });
});

describe('şablonlar ve benzerlik', () => {
  it('şablon birim uzunlukta; akor notaları en güçlü bileşenler', () => {
    const t = chordTemplate(0, 'maj');
    expect(Math.hypot(...t)).toBeCloseTo(1, 6);
    const top = [...t.keys()].sort((a, b) => t[b] - t[a]).slice(0, 3).sort((a, b) => a - b);
    expect(top).toEqual([0, 4, 7]);
  });

  it('aynı notalardan oluşan akorları bas notası ayırır (Asus2 / Esus4)', () => {
    const asus2 = analyze(primaryShape('Asus2')!, { style: 'down' });
    const esus4 = analyze(primaryShape('Esus4')!, { style: 'down' });
    expect(asus2.bass).toBe(9);
    expect(esus4.bass).toBe(4);
    expect(recognizeChord(asus2.chroma, asus2.bass)!.symbol).toBe('Asus2');
    expect(recognizeChord(esus4.chroma, esus4.bass)!.symbol).toBe('Esus4');
  });
});

describe('beklenen akor denetimi', () => {
  const target = (sym: string) => {
    const s = primaryShape(sym)!;
    return { root: s.root, quality: s.quality, symbol: s.symbol };
  };

  it('doğru akor kabul, yanlış akor ret', () => {
    const pairs: [string, string][] = [
      ['Am', 'C'],
      ['Em', 'G'],
      ['C', 'G'],
      ['D', 'A'],
      ['G', 'D'],
      ['Am', 'Em'],
      ['C', 'F'],
      ['E', 'A'],
      ['Dm', 'G7'],
      ['E5', 'A5'],
    ];
    let checks = 0;
    for (const [a, b] of pairs) {
      for (const [played, other] of [[a, b], [b, a]]) {
        for (const style of ['down', 'up'] as Style[]) {
          const f = analyze(primaryShape(played)!, { style, jitter: 5, snr: 25, seed: checks + 1 });
          expect(isChordPlayed(f.chroma, f.bass, target(played)), `${played} çalındı`).toBe(true);
          expect(isChordPlayed(f.chroma, f.bass, target(other)), `${played} çalınırken ${other}`).toBe(false);
          expect(pickTarget(f.chroma, f.bass, [target(a), target(b)])).toBe(played === a ? 0 : 1);
          checks++;
        }
      }
    }
    expect(checks).toBe(40);
  });

  it('sessizlikte ve ilgisiz bir akorda aday seçilmez', () => {
    const silent = extractor.compute(new Float32Array(extractor.frameSize));
    expect(pickTarget(silent.chroma, silent.bass, [target('Am'), target('C')])).toBe(-1);
    const f = analyze(primaryShape('B7')!, { style: 'down' });
    expect(pickTarget(f.chroma, f.bass, [target('Em'), target('G')])).toBe(-1);
    expect(chordSimilarity(silent.chroma, 0, 'maj')).toBe(0);
  });
});

describe('geçiş sayacı', () => {
  it('kararlı akor değişimlerini sayar; kısa belirsizlikleri ve tek karelik hataları yok sayar', () => {
    const c = new TransitionCounter(3);
    const feed = (seq: number[]) => seq.map((x) => c.push(x));
    feed([-1, -1, 0, 0, 0, 0]); // ilk akor: sayılmaz
    expect(c.count).toBe(0);
    expect(c.current).toBe(0);
    feed([-1, 1, 1, 1, 1]); // A → B
    expect(c.count).toBe(1);
    feed([1, 0, 1, 1]); // tek karelik sıçrama
    expect(c.count).toBe(1);
    feed([-1, -1, 0, 0, 0]); // B → A
    expect(c.count).toBe(2);
    feed([0, 0, -1, 0, 0, 0]); // aynı akor yeniden vuruldu: geçiş değil
    expect(c.count).toBe(2);
    feed([1, 1, 0, 0, 1, 1, 1]); // kararsız geçiş, sonunda B
    expect(c.count).toBe(3);
    c.reset();
    expect(c.count).toBe(0);
    expect(c.current).toBe(-1);
  });

  it('sentez sesle: Am ↔ C arası 6 geçiş doğru sayılır', () => {
    const shapes = [primaryShape('Am')!, primaryShape('C')!];
    const targets = shapes.map((s) => ({ root: s.root, quality: s.quality, symbol: s.symbol }));
    // Her akor 0,7 sn; 7 akor = 6 geçiş.
    const seg = Math.round(0.7 * SR);
    const total = new Float32Array(seg * 7 + extractor.frameSize);
    for (let i = 0; i < 7; i++) {
      const s = strum(shapes[i % 2], { style: i % 3 === 0 ? 'up' : 'down', seed: i + 1 });
      for (let k = 0; k < seg; k++) total[i * seg + k] += s[k] * (k > seg - 2000 ? (seg - k) / 2000 : 1);
    }
    const counter = new TransitionCounter(3);
    const hop = 2048;
    for (let start = 0; start + extractor.frameSize <= total.length; start += hop) {
      const f = extractor.compute(total.subarray(start, start + extractor.frameSize));
      counter.push(f.rms < 0.003 ? -1 : pickTarget(f.chroma, f.bass, targets));
    }
    expect(counter.count).toBe(6);
  });
});
