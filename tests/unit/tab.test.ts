import { describe, expect, it } from 'vitest';
import { BUILTIN_TABS } from '../../src/features/tabs/builtin';
import {
  addBar,
  buildTab,
  clampRange,
  EMPTY,
  emptyTab,
  isTab,
  MAX_BARS,
  MAX_FRET,
  MUTED,
  noteCount,
  notesAt,
  removeBar,
  setNote,
  stepAt,
  STEPS_PER_BAR,
  toAscii,
  totalSteps,
} from '../../src/music/tab';

describe('tab modeli', () => {
  it('boş tab, nota yazma ve silme; özgün nesne değişmez', () => {
    const tab = emptyTab('t', 'Deneme', 2, 100);
    expect(totalSteps(tab)).toBe(32);
    expect(noteCount(tab)).toBe(0);
    const a = setNote(tab, 4, 0, 3);
    expect(a.notes[4][0]).toBe(3);
    expect(tab.notes[4][0]).toBe(EMPTY);
    const b = setNote(a, 4, 0, EMPTY);
    expect(noteCount(b)).toBe(0);
    expect(setNote(a, 5, 5, MUTED).notes[5][5]).toBe(MUTED);
  });

  it('geçersiz konum ve perdeler yok sayılır', () => {
    const tab = emptyTab('t', 'x', 1);
    expect(setNote(tab, 16, 0, 1)).toBe(tab);
    expect(setNote(tab, -1, 0, 1)).toBe(tab);
    expect(setNote(tab, 0, 6, 1)).toBe(tab);
    expect(setNote(tab, 0, 0, MAX_FRET + 1)).toBe(tab);
    expect(setNote(tab, 0, 0, 2.5)).toBe(tab);
    expect(setNote(tab, 0, 0, MAX_FRET).notes[0][0]).toBe(24);
  });

  it('ölçü ekleme ve silme', () => {
    let tab = setNote(emptyTab('t', 'x', 1), 3, 2, 7);
    tab = addBar(tab);
    expect(tab.bars).toBe(2);
    expect(totalSteps(tab)).toBe(32);
    expect(tab.notes[3][2]).toBe(7);
    tab = setNote(tab, 20, 1, 5);
    tab = removeBar(tab);
    expect(tab.bars).toBe(1);
    expect(noteCount(tab)).toBe(1);
    // En az bir ölçü kalır; üst sınır aşılmaz.
    expect(removeBar(tab)).toBe(tab);
    let big = emptyTab('b', 'x', MAX_BARS);
    expect(addBar(big)).toBe(big);
    big = removeBar(big);
    expect(isTab(big)).toBe(true);
  });

  it('kayıt doğrulama', () => {
    const tab = setNote(emptyTab('t', 'x', 1), 0, 0, 5);
    expect(isTab(tab)).toBe(true);
    expect(isTab(JSON.parse(JSON.stringify(tab)))).toBe(true);
    expect(isTab({ ...tab, notes: tab.notes.slice(1) })).toBe(false);
    expect(isTab({ ...tab, bars: 0 })).toBe(false);
    const bad = JSON.parse(JSON.stringify(tab));
    bad.notes[0][0] = 99;
    expect(isTab(bad)).toBe(false);
    expect(isTab(null)).toBe(false);
  });
});

describe('çalınacak notalar', () => {
  // 6. tel açık (adım 0), 5. tel 2. perde (adım 0), 6. tel 3. perde (adım 4), 1. tel x (adım 8).
  const tab = buildTab('t', 'x', 100, 2, [
    [0, 6, 0],
    [0, 5, 2],
    [4, 6, 3],
    [8, 1, MUTED],
  ]);

  it('perde, tele göre doğru notaya çevrilir (standart akort)', () => {
    const notes = notesAt(tab, 0);
    expect(notes.map((n) => [n.string, n.midi])).toEqual([
      [0, 40],
      [1, 47],
    ]);
    expect(notesAt(tab, 4)[0].midi).toBe(43);
    expect(notesAt(tab, 1)).toEqual([]);
    expect(notesAt(tab, 999)).toEqual([]);
  });

  it('nota, aynı teldeki sonraki notaya kadar sürer', () => {
    const [low, a] = notesAt(tab, 0);
    // 6. telde sonraki nota 4. adımda.
    expect(low.steps).toBe(4);
    // 5. telde başka nota yok: tabın sonuna kadar (en çok 32 adım).
    expect(a.steps).toBe(32);
    // Çalınan bölüm 1. ölçüyle sınırlıysa nota ölçü sonunda kesilir.
    expect(notesAt(tab, 0, STEPS_PER_BAR)[1].steps).toBe(16);
    expect(notesAt(tab, 4, STEPS_PER_BAR)[0].steps).toBe(12);
  });

  it('susturulmuş nota kısa ve açık tel perdesindedir', () => {
    const [m] = notesAt(tab, 8);
    expect(m).toEqual({ string: 5, midi: 64, steps: 1, muted: true });
  });
});

describe('bölüm ve döngü', () => {
  it('geçen adım tab konumuna çevrilir', () => {
    const all = { from: 0, to: 2, loop: false };
    expect(stepAt(0, all)).toBe(0);
    expect(stepAt(47, all)).toBe(47);
    expect(stepAt(48, all)).toBe(-1);
    expect(stepAt(-1, all)).toBe(-1);
    // 2.–3. ölçüler arası döngü.
    const loop = { from: 1, to: 2, loop: true };
    expect(stepAt(0, loop)).toBe(16);
    expect(stepAt(31, loop)).toBe(47);
    expect(stepAt(32, loop)).toBe(16);
    expect(stepAt(32 * 5 + 3, loop)).toBe(19);
    // Tek ölçü döngüsü.
    expect([0, 15, 16, 17].map((n) => stepAt(n, { from: 2, to: 2, loop: true }))).toEqual([32, 47, 32, 33]);
  });

  it('aralık tabın sınırlarına çekilir', () => {
    const tab = emptyTab('t', 'x', 3);
    expect(clampRange(tab, { from: -2, to: 9, loop: true })).toEqual({ from: 0, to: 2, loop: true });
    expect(clampRange(tab, { from: 2, to: 0, loop: false })).toEqual({ from: 2, to: 2, loop: false });
  });
});

describe('düz metin çıktısı', () => {
  it('üstte ince tel, ölçü çizgileri, iki haneli perdeler', () => {
    const tab = buildTab('t', 'x', 100, 1, [
      [0, 6, 0],
      [2, 6, 12],
      [4, 1, MUTED],
    ]);
    const lines = toAscii(tab).split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[0].startsWith('e|')).toBe(true);
    expect(lines[5].startsWith('E|')).toBe(true);
    expect(lines[5]).toBe('E|0---12--------------------------|');
    expect(lines[0]).toBe('e|--------x-----------------------|');
    for (const l of lines) expect(l).toHaveLength(2 + 32 + 1);
  });
});

describe('hazır egzersizler', () => {
  it('hepsi geçerli, adlı ve nota içeriyor; perdeler çalınabilir aralıkta', () => {
    expect(BUILTIN_TABS.length).toBeGreaterThanOrEqual(4);
    const ids = new Set<string>();
    for (const tab of BUILTIN_TABS) {
      expect(isTab(tab), tab.id).toBe(true);
      expect(tab.builtin).toBe(true);
      expect(ids.has(tab.id)).toBe(false);
      ids.add(tab.id);
      expect(tab.name.length).toBeGreaterThan(3);
      expect(noteCount(tab)).toBeGreaterThanOrEqual(12);
      // Son ölçü boş değil (gereksiz ölçü yok).
      const last = tab.notes.slice((tab.bars - 1) * STEPS_PER_BAR);
      expect(last.some((c) => c.some((v) => v !== EMPTY)), tab.id).toBe(true);
      // Aynı anda basılan perdeler bir elin açıklığına sığar.
      for (const col of tab.notes) {
        const fretted = col.filter((v) => v > 0);
        if (fretted.length > 1) expect(Math.max(...fretted) - Math.min(...fretted)).toBeLessThanOrEqual(4);
      }
    }
  });

  it('kromatik ısınma her telde 1-2-3-4 çalar', () => {
    const tab = BUILTIN_TABS.find((x) => x.id === 'builtin:kromatik')!;
    expect(noteCount(tab)).toBe(24);
    // İlk dört nota 6. telde: F, F#, G, G#.
    expect([0, 2, 4, 6].map((s) => notesAt(tab, s)[0].midi)).toEqual([41, 42, 43, 44]);
    // Son nota 1. telde 4. perde.
    expect(notesAt(tab, 46)[0]).toMatchObject({ string: 5, midi: 68 });
  });

  it('pentatonik egzersiz yalnızca La minör pentatonik notalarını içerir', () => {
    const tab = BUILTIN_TABS.find((x) => x.id === 'builtin:pentatonik')!;
    const allowed = new Set([9, 0, 2, 4, 7]);
    let count = 0;
    for (let s = 0; s < totalSteps(tab); s++) {
      for (const n of notesAt(tab, s)) {
        expect(allowed.has(n.midi % 12), `adım ${s}`).toBe(true);
        count++;
      }
    }
    expect(count).toBe(23);
    // La ile başlar ve La ile biter.
    expect(notesAt(tab, 0)[0].midi % 12).toBe(9);
    expect(notesAt(tab, 44)[0].midi).toBe(45);
  });
});
