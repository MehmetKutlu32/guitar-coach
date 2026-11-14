import { describe, expect, it } from 'vitest';
import { resolveProgression } from '../../src/features/backing/Backing';
import {
  BAR_TICKS,
  bassNote,
  eventsAt,
  STYLE_IDS,
  STYLES,
  type BandEvent,
} from '../../src/features/backing/styles';
import {
  bassRoot,
  chordAtBeat,
  chordSpots,
  homeKey,
  nextChord,
  parseProgressionText,
  parseRoman,
  resolveTemplate,
  TEMPLATES,
  transposeBars,
  voiceChord,
  type Bar,
} from '../../src/music/progressions';
import { scaleNoteNames, scalePitchClasses, scaleRootName, SCALE_IDS, SCALES } from '../../src/music/scales';
import { chordPitchClasses, mod12 } from '../../src/music/theory';

const symbols = (bars: Bar[]) => bars.map((b) => b.map((c) => c.symbol).join(' ')).join(' | ');
const template = (id: string) => TEMPLATES.find((t) => t.id === id)!;

describe('roma rakamları ve hazır diziler', () => {
  it('roma rakamlarını ayrıştırır', () => {
    expect(parseRoman('I')).toEqual({ semitones: 0, quality: 'maj' });
    expect(parseRoman('vi')).toEqual({ semitones: 9, quality: 'min' });
    expect(parseRoman('bVII')).toEqual({ semitones: 10, quality: 'maj' });
    expect(parseRoman('ii7')).toEqual({ semitones: 2, quality: 'm7' });
    expect(parseRoman('V7')).toEqual({ semitones: 7, quality: '7' });
    expect(parseRoman('Imaj7')).toEqual({ semitones: 0, quality: 'maj7' });
    expect(parseRoman('bIII')).toEqual({ semitones: 3, quality: 'maj' });
    expect(parseRoman('X')).toBeNull();
    expect(parseRoman('Ifoo')).toBeNull();
  });

  it('tüm hazır diziler 12 tonda da çözülür', () => {
    const ids = new Set<string>();
    for (const t of TEMPLATES) {
      expect(ids.has(t.id)).toBe(false);
      ids.add(t.id);
      expect(t.scales.length).toBeGreaterThan(0);
      for (let key = 0; key < 12; key++) {
        const bars = resolveTemplate(t, key);
        expect(bars.length).toBeGreaterThanOrEqual(4);
        for (const bar of bars) expect(bar.length).toBeGreaterThan(0);
      }
    }
  });

  it('bilinen diziler doğru akorları verir', () => {
    expect(symbols(resolveTemplate(template('pop1564'), 0))).toBe('C | G | Am | F');
    expect(symbols(resolveTemplate(template('pop1564'), 7))).toBe('G | D | Em | C');
    expect(symbols(resolveTemplate(template('blues12'), 9))).toBe(
      'A7 | D7 | A7 | A7 | D7 | D7 | A7 | A7 | E7 | D7 | A7 | E7',
    );
    expect(symbols(resolveTemplate(template('jazz251'), 0))).toBe('Dm7 | G7 | Cmaj7 | Cmaj7');
    expect(symbols(resolveTemplate(template('andalusian'), 9))).toBe('Am | G | F | E');
    expect(symbols(resolveTemplate(template('minorRock'), 4))).toBe('Em | D | C | D');
    // Bemollü tonlarda bemol yazımı.
    expect(symbols(resolveTemplate(template('pop1564'), 5))).toBe('F | C | Dm | Bb');
    expect(symbols(resolveTemplate(template('minorPop'), 0))).toBe('Cm | Ab | Eb | Bb');
    // Diyezli tonlarda diyez yazımı.
    expect(symbols(resolveTemplate(template('pop1564'), 4))).toBe('E | B | C#m | A');
  });
});

describe('kullanıcı dizileri', () => {
  it('ölçüleri ve ölçü içi akorları ayrıştırır', () => {
    const p = parseProgressionText('Am | F | C G | E7');
    expect(p.errors).toEqual([]);
    expect(symbols(p.bars)).toBe('Am | F | C G | E7');
    // "|" yoksa her akor bir ölçü.
    expect(symbols(parseProgressionText('Em C G D').bars)).toBe('Em | C | G | D');
    // Satır sonları ölçü ayırır.
    expect(symbols(parseProgressionText('Am F\nC G').bars)).toBe('Am F | C G');
    expect(parseProgressionText('   ').bars).toEqual([]);
  });

  it('tanınmayan akorları bildirir', () => {
    const p = parseProgressionText('Am | Xq | C Hm | G');
    expect(p.errors).toEqual(['Xq', 'Hm']);
    expect(symbols(p.bars)).toBe('Am | C | G');
  });

  it('ev tonu ve transpoze', () => {
    const bars = parseProgressionText('Am | F | C | G').bars;
    expect(homeKey(bars)).toEqual({ root: 9, mode: 'minor' });
    expect(symbols(transposeBars(bars, 2))).toBe('Bm | G | D | A');
    expect(homeKey(parseProgressionText('G D').bars)).toEqual({ root: 7, mode: 'major' });
    expect(homeKey([])).toEqual({ root: 0, mode: 'major' });
  });

  it('seçili dizi ve ton çalınacak akorlara çözülür', () => {
    const customs = [{ id: 'x', name: 'Benim', text: 'Am | F | C | G' }];
    const same = resolveProgression('custom:x', 9, customs);
    expect(symbols(same.bars)).toBe('Am | F | C | G');
    expect(same.scales).toEqual(['minorPent', 'minor']);
    expect(symbols(resolveProgression('custom:x', 4, customs).bars)).toBe('Em | C | G | D');
    // Bilinmeyen kimlik ilk hazır diziye düşer.
    expect(resolveProgression('yok', 9, customs).bars).toHaveLength(12);
  });
});

describe('dizi içinde konum', () => {
  const bars = parseProgressionText('Am | F | C G | E7').bars;

  it('vuruştaki akor', () => {
    expect(chordAtBeat(bars[0], 3).symbol).toBe('Am');
    expect([0, 1, 2, 3].map((b) => chordAtBeat(bars[2], b).symbol)).toEqual(['C', 'C', 'G', 'G']);
    const three = parseProgressionText('C D E | G').bars[0];
    expect([0, 1, 2, 3].map((b) => chordAtBeat(three, b).symbol)).toEqual(['C', 'C', 'D', 'E']);
  });

  it('sıradaki akor: ölçü içi değişim, döngü ve dizi sonu', () => {
    expect(nextChord(bars, 0, 0, true)!.symbol).toBe('F');
    expect(nextChord(bars, 2, 0, true)!.symbol).toBe('G');
    expect(nextChord(bars, 2, 2, true)!.symbol).toBe('E7');
    expect(nextChord(bars, 3, 3, true)!.symbol).toBe('Am');
    expect(nextChord(bars, 3, 0, false)).toBeNull();
    // Tek akorlu dizide sıradaki akor yok.
    expect(nextChord(resolveTemplate(template('funkVamp'), 4), 1, 2, true)).toBeNull();
    // Ardışık aynı akorlar atlanır.
    const blues = resolveTemplate(template('blues12'), 9);
    expect(nextChord(blues, 2, 0, true)!.symbol).toBe('D7');
    expect(chordSpots(blues).map((s) => `${s.bar}:${s.chord.symbol}`)).toEqual([
      '0:A7',
      '1:D7',
      '2:A7',
      '4:D7',
      '6:A7',
      '8:E7',
      '9:D7',
      '10:A7',
      '11:E7',
    ]);
  });
});

describe('seslendirme', () => {
  it('akor notaları dar bir aralıkta ve akora ait', () => {
    for (const t of TEMPLATES) {
      for (const bar of resolveTemplate(t, 3)) {
        for (const chord of bar) {
          const v = voiceChord(chord);
          expect(v.length).toBeGreaterThanOrEqual(3);
          expect(Math.min(...v)).toBeGreaterThanOrEqual(51);
          expect(Math.max(...v)).toBeLessThanOrEqual(63 + 12);
          const allowed = new Set(chordPitchClasses(chord.root, chord.quality));
          for (const n of v) expect(allowed.has(mod12(n))).toBe(true);
          expect(v.some((n) => mod12(n) === chord.root)).toBe(true);
        }
      }
    }
  });

  it('bas notaları E1–D#2 kökü üzerine kurulur', () => {
    for (let pc = 0; pc < 12; pc++) {
      const r = bassRoot(pc);
      expect(r).toBeGreaterThanOrEqual(28);
      expect(r).toBeLessThanOrEqual(39);
      expect(mod12(r)).toBe(pc);
    }
    const a7 = { root: 9, quality: '7' as const, symbol: 'A7' };
    const am = { root: 9, quality: 'min' as const, symbol: 'Am' };
    expect(bassNote(a7, 'R')).toBe(33);
    expect(bassNote(a7, '3') - 33).toBe(4);
    expect(bassNote(am, '3') - 33).toBe(3);
    expect(bassNote(a7, '5') - 33).toBe(7);
    expect(bassNote(a7, '6') - 33).toBe(9);
    expect(bassNote(am, '6') - 33).toBe(10);
    expect(bassNote(a7, '8') - 33).toBe(12);
  });
});

describe('tarz kalıpları', () => {
  const bars = resolveTemplate(template('pop1564'), 0);
  const collect = (style: (typeof STYLE_IDS)[number], bar: number) => {
    const out: { tick: number; e: BandEvent }[] = [];
    for (let tick = 0; tick < BAR_TICKS; tick++) for (const e of eventsAt(bars, style, bar, tick)) out.push({ tick, e });
    return out;
  };

  it('kalıp konumları ölçü içinde; her tarz davul, bas ve akor üretir', () => {
    for (const id of STYLE_IDS) {
      const def = STYLES[id];
      for (const list of [def.kick, def.snare, def.ghost, def.hat, def.fill]) {
        for (const tick of list) {
          expect(tick).toBeGreaterThanOrEqual(0);
          expect(tick).toBeLessThan(BAR_TICKS);
        }
      }
      const events = collect(id, 1);
      const kinds = new Set(events.map((x) => x.e.kind));
      for (const k of ['kick', 'snare', 'hat', 'bass', 'chord']) expect(kinds.has(k as BandEvent['kind']), `${id}: ${k}`).toBe(true);
      // Birinci vuruşta kick ve bas kök notası.
      const first = events.filter((x) => x.tick === 0).map((x) => x.e);
      expect(first.some((e) => e.kind === 'kick')).toBe(true);
      const b = first.find((e) => e.kind === 'bass');
      expect(b && b.kind === 'bass' && mod12(b.midi)).toBe(bars[1][0].root);
      // Trampet 2. ve 4. vuruşta.
      const snares = events.filter((x) => x.e.kind === 'snare' && x.e.velocity > 0.5).map((x) => x.tick);
      expect(snares).toEqual([12, 36]);
    }
  });

  it('dizinin başında zil, son ölçüde geçiş', () => {
    expect(eventsAt(bars, 'rock', 0, 0).some((e) => e.kind === 'crash')).toBe(true);
    expect(eventsAt(bars, 'rock', 1, 0).some((e) => e.kind === 'crash')).toBe(false);
    const fill = collect('rock', 3).filter((x) => x.e.kind === 'snare' && x.tick >= 36);
    expect(fill.map((x) => x.tick)).toEqual([36, 39, 42, 45]);
    const blues = collect('blues', 3).filter((x) => x.e.kind === 'snare' && x.tick >= 36);
    expect(blues.map((x) => x.tick)).toEqual([36, 40, 44]);
  });

  it('ölçü içinde akor değişince bas ve akor yeni akora geçer', () => {
    const two = parseProgressionText('C G | Am').bars;
    const chordHits = [];
    for (let tick = 0; tick < BAR_TICKS; tick++) {
      for (const e of eventsAt(two, 'pop', 0, tick)) if (e.kind === 'chord') chordHits.push({ tick, e });
    }
    expect(chordHits.map((h) => h.tick)).toEqual([0, 24]);
    // İlk akor ikinci akorun üstüne taşmaz.
    expect(chordHits[0].e.beats).toBeLessThanOrEqual(2);
    const g = new Set(chordPitchClasses(7, 'maj'));
    for (const n of chordHits[1].e.midis) expect(g.has(mod12(n))).toBe(true);
    const bassAt24 = eventsAt(two, 'pop', 0, 24).find((e) => e.kind === 'bass');
    // Pop kalıbında 3. vuruşta beşli çalınır: G akorunun beşlisi D.
    expect(bassAt24 && bassAt24.kind === 'bass' && mod12(bassAt24.midi)).toBe(2);
  });

  it('dizi dışındaki ölçü için olay üretmez', () => {
    expect(eventsAt(bars, 'rock', 99, 0)).toEqual([]);
  });
});

describe('gamlar', () => {
  it('her gam kökünü içerir ve tekrarsızdır', () => {
    for (const id of SCALE_IDS) {
      const pcs = scalePitchClasses(4, id);
      expect(pcs[0]).toBe(4);
      expect(new Set(pcs).size).toBe(pcs.length);
      expect(pcs).toHaveLength(SCALES[id].intervals.length);
    }
  });

  it('nota yazımı tona uygun', () => {
    expect(scaleNoteNames(0, 'major')).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
    expect(scaleNoteNames(9, 'minorPent')).toEqual(['A', 'C', 'D', 'E', 'G']);
    expect(scaleNoteNames(9, 'blues')).toEqual(['A', 'C', 'D', 'Eb', 'E', 'G']);
    expect(scaleNoteNames(4, 'blues')).toEqual(['E', 'G', 'A', 'Bb', 'B', 'D']);
    expect(scaleNoteNames(5, 'major')).toEqual(['F', 'G', 'A', 'Bb', 'C', 'D', 'E']);
    expect(scaleNoteNames(4, 'major')).toEqual(['E', 'F#', 'G#', 'A', 'B', 'C#', 'D#']);
    expect(scaleNoteNames(2, 'minor')).toEqual(['D', 'E', 'F', 'G', 'A', 'Bb', 'C']);
    expect(scaleNoteNames(7, 'mixolydian')).toEqual(['G', 'A', 'B', 'C', 'D', 'E', 'F']);
    expect(scaleNoteNames(2, 'dorian')).toEqual(['D', 'E', 'F', 'G', 'A', 'B', 'C']);
    expect(scaleRootName(10, 'minorPent')).toBe('Bb');
    expect(scaleRootName(6, 'major')).toBe('Gb');
  });
});
