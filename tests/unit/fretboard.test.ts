import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../src/audio/synth/karplus';
import {
  answerChoices,
  arpeggioDegree,
  arpeggioDots,
  ARPEGGIO_QUALITIES,
  CAGED_ORDER,
  cagedPosition,
  cagedPositions,
  checkAnswer,
  degreeLabel,
  gameScore,
  isGameResult,
  neckPositions,
  nextQuestion,
  noteAt,
  parentMajorRoot,
  questionPool,
  scaleDots,
  scaleSteps,
  type GameSettings,
} from '../../src/music/fretboard';
import { SCALE_IDS, SCALES } from '../../src/music/scales';
import { mod12, QUALITIES } from '../../src/music/theory';

describe('saptaki notalar', () => {
  it('açık teller ve bilinen perdeler', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => noteAt(s, 0))).toEqual([40, 45, 50, 55, 59, 64]);
    // 6. tel 5. perde = La (5. telin açık sesi).
    expect(noteAt(0, 5)).toBe(noteAt(1, 0));
    // 3. tel 4. perde = Si (2. telin açık sesi).
    expect(noteAt(3, 4)).toBe(noteAt(4, 0));
    expect(noteAt(5, 12)).toBe(76);
  });

  it('gam konumları yalnızca gam notalarını içerir ve hiçbirini atlamaz', () => {
    for (const id of SCALE_IDS) {
      for (const root of [0, 4, 9]) {
        const dots = scaleDots(root, id, 0, 12);
        const allowed = new Set(SCALES[id].intervals.map((i) => mod12(root + i)));
        for (const d of dots) {
          expect(allowed.has(d.pc), `${id} kök ${root}`).toBe(true);
          expect(d.pc).toBe(mod12(noteAt(d.string, d.fret)));
          expect(d.interval).toBe(mod12(d.pc - root));
        }
        // 0–12 arasında her telde gamın her notası en az bir kez bulunur.
        for (let s = 0; s < 6; s++) {
          const onString = new Set(dots.filter((d) => d.string === s).map((d) => d.pc));
          expect(onString.size, `${id} tel ${s}`).toBe(allowed.size);
        }
      }
    }
  });

  it('La minör pentatonik 1. kalıp (5.–8. perdeler)', () => {
    const dots = scaleDots(9, 'minorPent', 5, 8);
    const byString = (s: number) => dots.filter((d) => d.string === s).map((d) => d.fret);
    expect(byString(0)).toEqual([5, 8]);
    expect(byString(1)).toEqual([5, 7]);
    expect(byString(2)).toEqual([5, 7]);
    expect(byString(3)).toEqual([5, 7]);
    expect(byString(4)).toEqual([5, 8]);
    expect(byString(5)).toEqual([5, 8]);
    // Kökler: 6. tel 5, 4. tel 7, 1. tel 5.
    expect(dots.filter((d) => d.interval === 0).map((d) => `${d.string}:${d.fret}`)).toEqual(['0:5', '2:7', '5:5']);
  });

  it('pencere sınırları dahildir', () => {
    const dots = neckPositions(4, [0], 12, 24);
    expect(dots.every((d) => d.fret >= 12 && d.fret <= 24)).toBe(true);
    expect(dots.some((d) => d.fret === 12 && d.string === 0)).toBe(true);
    expect(dots.some((d) => d.fret === 24 && d.string === 5)).toBe(true);
  });
});

describe('dereceler ve formüller', () => {
  it('gam dereceleri majör gama göre adlandırılır', () => {
    const label = (id: (typeof SCALE_IDS)[number]) => SCALES[id].intervals.map((i) => degreeLabel(i, SCALES[id].intervals)).join(' ');
    expect(label('major')).toBe('1 2 3 4 5 6 7');
    expect(label('minor')).toBe('1 2 b3 4 5 b6 b7');
    expect(label('dorian')).toBe('1 2 b3 4 5 6 b7');
    expect(label('phrygian')).toBe('1 b2 b3 4 5 b6 b7');
    expect(label('lydian')).toBe('1 2 3 #4 5 6 7');
    expect(label('mixolydian')).toBe('1 2 3 4 5 6 b7');
    expect(label('locrian')).toBe('1 b2 b3 4 b5 b6 b7');
    expect(label('harmonicMinor')).toBe('1 2 b3 4 5 b6 7');
    expect(label('melodicMinor')).toBe('1 2 b3 4 5 6 7');
    // Beş ve altı notalı gamlar genel adları kullanır.
    expect(label('minorPent')).toBe('1 b3 4 5 b7');
    expect(label('majorPent')).toBe('1 2 3 5 6');
    expect(label('blues')).toBe('1 b3 4 b5 5 b7');
  });

  it('arpej dereceleri', () => {
    const label = (q: (typeof ARPEGGIO_QUALITIES)[number]) => QUALITIES[q].intervals.map((i) => arpeggioDegree(i, q)).join(' ');
    expect(label('maj')).toBe('1 3 5');
    expect(label('min')).toBe('1 b3 5');
    expect(label('7')).toBe('1 3 5 b7');
    expect(label('maj7')).toBe('1 3 5 7');
    expect(label('m7b5')).toBe('1 b3 b5 b7');
    expect(label('dim7')).toBe('1 b3 b5 bb7');
    expect(label('aug')).toBe('1 3 #5');
    expect(label('6')).toBe('1 3 5 6');
    expect(label('9')).toBe('1 9 3 5 b7');
    for (const q of ARPEGGIO_QUALITIES) {
      const dots = arpeggioDots(0, q, 0, 12);
      expect(new Set(dots.map((d) => d.interval)).size).toBe(new Set(QUALITIES[q].intervals).size);
    }
  });

  it('gam formülü 12 yarım tona tamamlanır', () => {
    expect(scaleSteps('major')).toEqual([2, 2, 1, 2, 2, 2, 1]);
    expect(scaleSteps('minorPent')).toEqual([3, 2, 2, 3, 2]);
    expect(scaleSteps('harmonicMinor')).toEqual([2, 1, 2, 2, 1, 3, 1]);
    for (const id of SCALE_IDS) expect(scaleSteps(id).reduce((s, v) => s + v, 0)).toBe(12);
  });

  it('modların ait olduğu majör gam', () => {
    expect(parentMajorRoot(2, 'dorian')).toBe(0); // Re Dorian → Do majör
    expect(parentMajorRoot(7, 'mixolydian')).toBe(0); // Sol Miksolidyen → Do majör
    expect(parentMajorRoot(9, 'minor')).toBe(0); // La minör → Do majör
    expect(parentMajorRoot(4, 'phrygian')).toBe(0);
    expect(parentMajorRoot(5, 'lydian')).toBe(0);
    expect(parentMajorRoot(11, 'locrian')).toBe(0);
    expect(parentMajorRoot(0, 'major')).toBeNull();
    expect(parentMajorRoot(9, 'minorPent')).toBeNull();
    expect(parentMajorRoot(9, 'harmonicMinor')).toBeNull();
  });
});

describe('CAGED', () => {
  it('her biçim yalnızca majör akorun notalarını çalar ve en kalın nota köktür', () => {
    for (let root = 0; root < 12; root++) {
      for (const shape of CAGED_ORDER) {
        const pos = cagedPosition(root, shape);
        const triad = new Set([root, mod12(root + 4), mod12(root + 7)]);
        for (const d of pos.dots) expect(triad.has(d.pc), `${shape} kök ${root}`).toBe(true);
        expect(new Set(pos.dots.map((d) => d.pc)).size).toBe(3);
        const lowest = [...pos.dots].sort((a, b) => a.string - b.string)[0];
        expect(lowest.interval).toBe(0);
        // Bir elin açıklığına sığar.
        expect(pos.toFret - pos.fromFret).toBeLessThanOrEqual(3);
        expect(pos.fromFret).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('açık konumda biçimler kendi adlarını taşıyan akorlardır', () => {
    expect(cagedPosition(0, 'C').dots.map((d) => d.fret)).toEqual([3, 2, 0, 1, 0]);
    expect(cagedPosition(9, 'A').fromFret).toBe(0);
    expect(cagedPosition(7, 'G').dots.map((d) => d.fret)).toEqual([3, 2, 0, 0, 0, 3]);
    expect(cagedPosition(4, 'E').dots.map((d) => d.fret)).toEqual([0, 2, 2, 1, 0, 0]);
    expect(cagedPosition(2, 'D').dots.map((d) => d.fret)).toEqual([0, 2, 3, 2]);
  });

  it('Do majör için beş konum sap boyunca C-A-G-E-D sırasıyla dizilir', () => {
    const positions = cagedPositions(0);
    expect(positions.map((p) => p.shape)).toEqual(['C', 'A', 'G', 'E', 'D']);
    expect(positions.map((p) => p.fromFret)).toEqual([0, 3, 5, 8, 10]);
    // Komşu konumlar ortak perdede buluşur (biri bittiği yerde diğeri başlar ya da örtüşür).
    for (let i = 1; i < positions.length; i++) expect(positions[i].fromFret).toBeLessThanOrEqual(positions[i - 1].toFret);
  });

  it('F majör, E biçimiyle 1. perdede bare akordur', () => {
    const pos = cagedPosition(5, 'E');
    expect(pos.dots.map((d) => d.fret)).toEqual([1, 3, 3, 2, 1, 1]);
  });
});

describe('nota ezberleme oyunu', () => {
  const base: GameSettings = { mode: 'name', maxFret: 5, naturalsOnly: true, strings: [0, 1, 2, 3, 4, 5] };

  it('soru havuzu ayarlara uyar', () => {
    const naturals = questionPool(base);
    expect(naturals.every((q) => [0, 2, 4, 5, 7, 9, 11].includes(q.pc) && q.fret <= 5)).toBe(true);
    // 0–5. perdelerde her telde 4 doğal nota vardır: 36 konumdan 24'ü.
    expect(naturals).toHaveLength(24);
    for (let s = 0; s < 6; s++) expect(naturals.filter((q) => q.string === s)).toHaveLength(4);
    expect(questionPool({ ...base, naturalsOnly: false })).toHaveLength(36);
    expect(questionPool({ ...base, maxFret: 12, naturalsOnly: false })).toHaveLength(78);
    // "Perdeyi bul" modunda açık tel sorulmaz.
    expect(questionPool({ ...base, mode: 'find', naturalsOnly: false }).every((q) => q.fret >= 1)).toBe(true);
    expect(questionPool({ ...base, strings: [0] }).every((q) => q.string === 0)).toBe(true);
  });

  it('sorular havuzdan gelir, art arda aynı soru sorulmaz ve zamanla tüm havuz görülür', () => {
    const rand = mulberry32(7);
    const pool = questionPool(base);
    const seen = new Set<string>();
    let prev = nextQuestion(base, null, rand);
    for (let i = 0; i < 600; i++) {
      const q = nextQuestion(base, prev, rand);
      expect(q.string === prev.string && q.fret === prev.fret).toBe(false);
      expect(pool.some((p) => p.string === q.string && p.fret === q.fret)).toBe(true);
      seen.add(`${q.string}:${q.fret}`);
      prev = q;
    }
    expect(seen.size).toBe(pool.length);
    // Rastgele değer sınırda olsa da geçerli bir soru döner.
    expect(nextQuestion(base, null, () => 0.999999)).toBeDefined();
    expect(nextQuestion(base, null, () => 0)).toBeDefined();
  });

  it('yanıt denetimi', () => {
    const q = { string: 0, fret: 3, pc: 7 }; // 6. tel 3. perde = Sol
    expect(checkAnswer('name', q, 7)).toBe(true);
    expect(checkAnswer('name', q, 6)).toBe(false);
    expect(checkAnswer('find', q, 3)).toBe(true);
    expect(checkAnswer('find', q, 15)).toBe(true);
    expect(checkAnswer('find', q, 4)).toBe(false);
    expect(answerChoices(base)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    expect(answerChoices({ ...base, naturalsOnly: false })).toHaveLength(12);
  });

  it('puan ve kayıt doğrulama', () => {
    expect(gameScore(8, 10)).toBe(80);
    expect(gameScore(0, 0)).toBe(0);
    const r = { id: 'x', type: 'fretgame', date: 1, mode: 'name', maxFret: 5, naturalsOnly: true, correct: 8, total: 10, seconds: 20 };
    expect(isGameResult(r)).toBe(true);
    expect(isGameResult({ ...r, type: 'rhythm' })).toBe(false);
    expect(isGameResult(undefined)).toBe(false);
  });
});
