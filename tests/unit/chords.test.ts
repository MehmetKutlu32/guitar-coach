import { describe, expect, it } from 'vitest';
import {
  isNewBest,
  isTransitionResult,
  pairKey,
  perMinute,
  resultsForPair,
  splitPair,
  summarizePairs,
  type TransitionResult,
} from '../../src/features/chords/transitions';
import {
  ALL_CHORDS,
  BARRE_CHORDS,
  chordsFor,
  chordSymbols,
  diagramLayout,
  OPEN_CHORDS,
  POWER_CHORDS,
  primaryShape,
  shapeNotes,
} from '../../src/music/chords';
import { chordPitchClasses, chordSymbol, mod12, parseChord, parseNoteName, transposeChord } from '../../src/music/theory';

describe('müzik teorisi', () => {
  it('nota adları ve akor simgeleri ayrıştırılır', () => {
    expect(parseNoteName('C')).toBe(0);
    expect(parseNoteName('F#')).toBe(6);
    expect(parseNoteName('Bb')).toBe(10);
    expect(parseNoteName('H')).toBeNull();
    expect(parseChord('Am')).toEqual({ root: 9, quality: 'min' });
    expect(parseChord('F#m7')).toEqual({ root: 6, quality: 'm7' });
    expect(parseChord('Bbmaj7')).toEqual({ root: 10, quality: 'maj7' });
    expect(parseChord('C/G')).toEqual({ root: 0, quality: 'maj', bass: 7 });
    expect(parseChord('Dsus4')).toEqual({ root: 2, quality: 'sus4' });
    expect(parseChord('E5')).toEqual({ root: 4, quality: '5' });
    expect(parseChord('Xyz')).toBeNull();
    expect(parseChord('Cfoo')).toBeNull();
  });

  it('akor notaları ve transpoze', () => {
    expect(chordPitchClasses(0, 'maj')).toEqual([0, 4, 7]);
    expect(chordPitchClasses(9, 'm7')).toEqual([9, 0, 4, 7]);
    expect(chordSymbol(3, 'min')).toBe('Ebm');
    expect(transposeChord('Am', 2)).toBe('Bm');
    expect(transposeChord('C/G', 2)).toBe('D/A');
    expect(transposeChord('G7', -2)).toBe('F7');
    expect(transposeChord('N.C.', 3)).toBe('N.C.');
  });
});

describe('akor kütüphanesi', () => {
  it('her biçim geçerli ve doğru notaları çalıyor', () => {
    const ids = new Set<string>();
    for (const shape of ALL_CHORDS) {
      expect(ids.has(shape.id), shape.id).toBe(false);
      ids.add(shape.id);
      expect(shape.frets, shape.id).toHaveLength(6);
      expect(shape.fingers, shape.id).toHaveLength(6);
      expect(parseChord(shape.symbol), shape.id).toEqual({ root: shape.root, quality: shape.quality });

      const notes = shapeNotes(shape);
      const allowed = new Set(chordPitchClasses(shape.root, shape.quality));
      const played = new Set(notes.map(mod12));
      // Çalınan her nota akora ait.
      for (const pc of played) expect(allowed.has(pc), `${shape.id}: yabancı nota ${pc}`).toBe(true);
      // En kalın çalınan nota köktür.
      expect(mod12(notes[0]), `${shape.id}: bas kök değil`).toBe(shape.root);
      // Yalnızca beşli eksik olabilir (ör. açık C7).
      const missing = [...allowed].filter((pc) => !played.has(pc));
      for (const pc of missing) expect(mod12(pc - shape.root), `${shape.id}: eksik nota`).toBe(7);

      shape.frets.forEach((f, i) => {
        // Basılan perdede parmak yazılı; açık/çalınmayan telde parmak yok.
        if (f > 0) expect(shape.fingers[i], `${shape.id} tel ${i}`).toBeGreaterThan(0);
        else expect(shape.fingers[i], `${shape.id} tel ${i}`).toBe(0);
      });
      // El açıklığı en fazla 4 perde.
      const fretted = shape.frets.filter((f) => f > 0);
      if (fretted.length) expect(Math.max(...fretted) - Math.min(...fretted), shape.id).toBeLessThanOrEqual(3);
    }
    expect(OPEN_CHORDS.length).toBeGreaterThanOrEqual(25);
  });

  it('bare ve power akorlar 12 kökün tamamını kapsar', () => {
    for (let root = 0; root < 12; root++) {
      const barre = chordsFor('barre', root);
      for (const q of ['maj', 'min', '7', 'm7'] as const) {
        expect(barre.some((s) => s.quality === q), `kök ${root} ${q}`).toBe(true);
      }
      expect(chordsFor('power', root)).toHaveLength(2);
    }
    for (const s of BARRE_CHORDS) expect(diagramLayout(s).barre, s.id).not.toBeNull();
    for (const s of POWER_CHORDS) expect(shapeNotes(s)).toHaveLength(3);
  });

  it('diyagram yerleşimi', () => {
    const c = diagramLayout(primaryShape('C')!);
    expect(c).toEqual({ baseFret: 1, rows: 4, barre: null });
    const f = BARRE_CHORDS.find((s) => s.id === 'barre6:F')!;
    expect(diagramLayout(f)).toEqual({ baseFret: 1, rows: 4, barre: { fret: 1, from: 0, to: 5 } });
    const b = BARRE_CHORDS.find((s) => s.id === 'barre6:B')!;
    expect(diagramLayout(b).baseFret).toBe(7);
    expect(diagramLayout(b).rows).toBe(4);
    const bm = BARRE_CHORDS.find((s) => s.id === 'barre5:Bm')!;
    expect(diagramLayout(bm).barre).toEqual({ fret: 2, from: 1, to: 5 });
    // Küçük bare: açık F.
    expect(diagramLayout(primaryShape('F')!).barre).toEqual({ fret: 1, from: 4, to: 5 });
  });

  it('simge için önerilen biçim: önce açık akor, sonra en alçak perde', () => {
    expect(primaryShape('Am')!.category).toBe('open');
    expect(primaryShape('F')!.id).toBe('open:F');
    expect(primaryShape('F#m')!.id).toBe('barre6:F#m');
    expect(primaryShape('Bm')!.id).toBe('barre5:Bm');
    expect(primaryShape('Bb')!.id).toBe('barre5:Bb');
    expect(primaryShape('E5')!.frets).toEqual([0, 2, 2, -1, -1, -1]);
    expect(primaryShape('E5')!.fingers).toEqual([0, 1, 2, 0, 0, 0]);
    expect(primaryShape('Yok')).toBeUndefined();
    // Seçim listelerinde her simge bir kez.
    const all = [...chordSymbols('open'), ...chordSymbols('barre'), ...chordSymbols('power')];
    expect(new Set(all).size).toBe(all.length);
    expect(chordSymbols('barre')).not.toContain('Am');
    expect(chordSymbols('power')).toHaveLength(12);
  });

  it('standart akortta çalınan notalar', () => {
    expect(shapeNotes(primaryShape('Em')!)).toEqual([40, 47, 52, 55, 59, 64]);
    expect(shapeNotes(primaryShape('D')!)).toEqual([50, 57, 62, 66]);
  });
});

describe('geçiş egzersizi sonuçları', () => {
  const mk = (a: string, b: string, count: number, date: number, seconds = 60): TransitionResult => ({
    id: `${a}${b}${date}`,
    type: 'transition',
    date,
    a,
    b,
    pair: pairKey(a, b),
    count,
    seconds,
  });

  it('çift anahtarı sıradan bağımsız', () => {
    expect(pairKey('G', 'Em')).toBe(pairKey('Em', 'G'));
    expect(splitPair(pairKey('G', 'Em'))).toEqual(['Em', 'G']);
  });

  it('farklı süreler dakika başına çevrilir', () => {
    expect(perMinute({ count: 20, seconds: 60 })).toBe(20);
    expect(perMinute({ count: 12, seconds: 30 })).toBe(24);
    expect(perMinute({ count: 50, seconds: 120 })).toBe(25);
    expect(perMinute({ count: 5, seconds: 0 })).toBe(0);
  });

  it('çift özetleri ve sıralama', () => {
    const results = [mk('Em', 'G', 20, 100), mk('G', 'Em', 26, 300), mk('Am', 'C', 15, 200), mk('Em', 'G', 12, 400, 30)];
    const list = summarizePairs(results);
    expect(list.map((p) => p.pair)).toEqual(['Em|G', 'Am|C']);
    expect(list[0]).toMatchObject({ sessions: 3, best: 26, last: 24, average: 23, improvement: 4, lastDate: 400 });
    expect(list[1]).toMatchObject({ sessions: 1, best: 15, last: 15, improvement: 0 });
    expect(resultsForPair(results, 'Em|G').map((r) => r.date)).toEqual([100, 300, 400]);
    expect(summarizePairs([])).toEqual([]);
  });

  it('rekor yalnızca önceki en iyiyi geçince', () => {
    const prev = [mk('Em', 'G', 20, 1), mk('Em', 'G', 25, 2)];
    expect(isNewBest([], { count: 99, seconds: 60 })).toBe(false);
    expect(isNewBest(prev, { count: 25, seconds: 60 })).toBe(false);
    expect(isNewBest(prev, { count: 26, seconds: 60 })).toBe(true);
    expect(isNewBest(prev, { count: 13, seconds: 30 })).toBe(true);
  });

  it('bozuk kayıtlar ayıklanır', () => {
    expect(isTransitionResult(mk('A', 'D', 1, 1))).toBe(true);
    expect(isTransitionResult({ type: 'transition', id: 'x' })).toBe(false);
    expect(isTransitionResult({ ...mk('A', 'D', 1, 1), type: 'rhythm' })).toBe(false);
    expect(isTransitionResult(null)).toBe(false);
  });
});
