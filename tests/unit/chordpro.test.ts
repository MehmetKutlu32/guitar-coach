import { describe, expect, it } from 'vitest';
import { BUILTIN_SONGS, isSongRecord, NEW_SONG_TEXT } from '../../src/features/songs/builtin';
import {
  buildTimeline,
  chordEvents,
  eventAt,
  parseChordPro,
  parseLine,
  shownChord,
  songKeyRoot,
  soundingChord,
  timelineSeconds,
  uniqueChords,
} from '../../src/music/chordpro';
import { primaryShape } from '../../src/music/chords';

const SONG = `{title: Deneme}
{artist: Ben}
{key: Am}
{tempo: 96}
{capo: 2}
# bu satır yorumdur
{comment: Yavaş başla}

{start_of_verse}
[Am]Bir iki [F]üç
Akorsuz satır
[C][G]
{end_of_verse}


{soc: Nakarat}
Söz [Am]ortada ve [Xyz]bilinmeyen
{eoc}
`;

describe('ChordPro satır ayrıştırma', () => {
  it('akorları sözün içindeki yerleriyle ayırır', () => {
    expect(parseLine('[Am]Merhaba [C]dünya')).toEqual([
      { chord: 'Am', text: 'Merhaba ' },
      { chord: 'C', text: 'dünya' },
    ]);
    // Akordan önce söz varsa akorsuz bir parça olur.
    expect(parseLine('Önce söz [G]sonra akor')).toEqual([
      { chord: undefined, text: 'Önce söz ' },
      { chord: 'G', text: 'sonra akor' },
    ]);
    // Yalnızca akorlardan oluşan satır.
    expect(parseLine('[C][G]')).toEqual([
      { chord: 'C', text: '' },
      { chord: 'G', text: '' },
    ]);
    // Satır sonundaki akor.
    expect(parseLine('Bitti [D]')).toEqual([
      { chord: undefined, text: 'Bitti ' },
      { chord: 'D', text: '' },
    ]);
    expect(parseLine('Düz söz')).toEqual([{ chord: undefined, text: 'Düz söz' }]);
    expect(parseLine('')).toEqual([]);
  });
});

describe('ChordPro belge ayrıştırma', () => {
  const song = parseChordPro(SONG);

  it('yönergeleri okur', () => {
    expect(song).toMatchObject({ title: 'Deneme', artist: 'Ben', key: 'Am', tempo: 96, capo: 2 });
  });

  it('satır türlerini, bölümleri ve boşlukları korur; yorum satırlarını atlar', () => {
    expect(song.lines.map((l) => l.type)).toEqual([
      'comment',
      'empty',
      'section',
      'lyrics',
      'lyrics',
      'lyrics',
      'empty',
      'section',
      'lyrics',
    ]);
    expect(song.lines[0]).toEqual({ type: 'comment', text: 'Yavaş başla' });
    expect(song.lines[2]).toEqual({ type: 'section', kind: 'verse', label: '' });
    expect(song.lines[7]).toEqual({ type: 'section', kind: 'chorus', label: 'Nakarat' });
    const verse = song.lines[3];
    expect(verse.type === 'lyrics' && verse.section).toBe('verse');
    const chorus = song.lines[8];
    expect(chorus.type === 'lyrics' && chorus.section).toBe('chorus');
  });

  it('kısa yönerge adları, Windows satır sonları ve bozuk değerler', () => {
    const s = parseChordPro('{t: Kısa}\r\n{st: Sanatçı}\r\n{tempo: hızlı}\r\n{capo: 30}\r\n{bilinmeyen: x}\r\n[E]Söz\r\n');
    expect(s).toMatchObject({ title: 'Kısa', artist: 'Sanatçı', tempo: null, capo: 11 });
    expect(s.lines).toHaveLength(1);
    expect(parseChordPro('').lines).toEqual([]);
    expect(parseChordPro('\n\n\n').lines).toEqual([]);
  });

  it('akor olaylarını sırayla ve çalınabilirlik bilgisiyle verir', () => {
    const ev = chordEvents(song);
    expect(ev.map((e) => e.written)).toEqual(['Am', 'F', 'C', 'G', 'Am', 'Xyz']);
    expect(ev.map((e) => e.playable)).toEqual([true, true, true, true, true, false]);
    expect(ev[0]).toMatchObject({ line: 3, segment: 0 });
    expect(ev[4]).toMatchObject({ line: 8, segment: 1 });
  });
});

describe('transpoze ve kapo', () => {
  it('gösterilen akor kapoya göre düşer, duyulan akor düşmez', () => {
    expect(shownChord('Am', 0, 0)).toBe('Am');
    expect(soundingChord('Am', 2)).toBe('Bm');
    // +2 transpoze, 2. perdede kapo: yine Am basılır, Bm duyulur.
    expect(shownChord('Am', 2, 2)).toBe('Am');
    expect(shownChord('C', 0, 3)).toBe('A');
    expect(shownChord('G7', -2, 0)).toBe('F7');
    expect(shownChord('C/G', 2, 0)).toBe('D/A');
    // Tanınmayan yazım olduğu gibi kalır.
    expect(shownChord('N.C.', 3, 1)).toBe('N.C.');
  });

  it('şarkıdaki akorlar tekrarsız ve gösterildiği biçimde', () => {
    const song = parseChordPro(SONG);
    expect(uniqueChords(song, 0, 0)).toEqual(['Am', 'F', 'C', 'G']);
    expect(uniqueChords(song, 0, 2)).toEqual(['Gm', 'Eb', 'Bb', 'F']);
    expect(songKeyRoot(song)).toBe(9);
    expect(songKeyRoot(parseChordPro('[D]la la'))).toBe(2);
    expect(songKeyRoot(parseChordPro('söz'))).toBeNull();
  });
});

describe('zaman çizelgesi', () => {
  const song = parseChordPro('[Am]a [F]b [C]c [G]d [Xyz]e [Em]f');

  it('akor başına 4 vuruş: her akor bir ölçü; tanınmayan akor atlanır', () => {
    const tl = buildTimeline(song, 0, 4);
    expect(tl.bars.map((b) => b.map((c) => c.symbol).join(' '))).toEqual(['Am', 'F', 'C', 'G', 'Em']);
    expect(tl.steps).toEqual([0, 1, 2, 3, 5]);
    expect(eventAt(tl, 0, 0)).toBe(0);
    expect(eventAt(tl, 0, 3)).toBe(0);
    expect(eventAt(tl, 1, 0)).toBe(1);
    expect(eventAt(tl, 4, 2)).toBe(5);
    expect(timelineSeconds(tl, 120)).toBe(10);
  });

  it('akor başına 2 vuruş: iki akor bir ölçü; tek kalan ölçü tamamlanır', () => {
    const tl = buildTimeline(song, 0, 2);
    expect(tl.bars.map((b) => b.map((c) => c.symbol).join(' '))).toEqual(['Am F', 'C G', 'Em']);
    expect(eventAt(tl, 0, 1)).toBe(0);
    expect(eventAt(tl, 0, 2)).toBe(1);
    expect(eventAt(tl, 1, 3)).toBe(3);
    // Tamamlama vuruşlarında son akor gösterilmeye devam eder.
    expect(eventAt(tl, 2, 3)).toBe(5);
  });

  it('akor başına 1 ve 8 vuruş', () => {
    const one = buildTimeline(song, 0, 1);
    expect(one.bars.map((b) => b.map((c) => c.symbol).join(' '))).toEqual(['Am F C G', 'Em']);
    expect(eventAt(one, 0, 2)).toBe(2);
    const eight = buildTimeline(song, 0, 8);
    expect(eight.bars).toHaveLength(10);
    expect(eventAt(eight, 1, 3)).toBe(0);
    expect(eventAt(eight, 2, 0)).toBe(1);
  });

  it('transpoze eşlikteki akorlara yansır', () => {
    expect(buildTimeline(song, 2, 4).bars[0][0].symbol).toBe('Bm');
    expect(buildTimeline(parseChordPro('yalnız söz'), 0, 4)).toMatchObject({ bars: [], steps: [] });
    expect(eventAt(buildTimeline(parseChordPro('söz'), 0, 4), 0, 0)).toBe(-1);
  });
});

describe('hazır şarkılar', () => {
  it('hepsi ayrıştırılır, başlıklı, tüm akorları çalınabilir ve kütüphanede var', () => {
    expect(BUILTIN_SONGS.length).toBeGreaterThanOrEqual(3);
    const ids = new Set<string>();
    for (const record of BUILTIN_SONGS) {
      expect(isSongRecord(record)).toBe(true);
      expect(ids.has(record.id)).toBe(false);
      ids.add(record.id);
      const song = parseChordPro(record.text);
      expect(song.title.length).toBeGreaterThan(0);
      const events = chordEvents(song);
      expect(events.length).toBeGreaterThanOrEqual(8);
      for (const e of events) expect(e.playable, `${record.id}: ${e.written}`).toBe(true);
      for (const sym of uniqueChords(song, 0, 0)) expect(primaryShape(sym), `${record.id}: ${sym}`).toBeDefined();
      // Her akor bir ölçü: ölçü sayısı akor sayısına eşit.
      expect(buildTimeline(song, 0, record.beatsPerChord).bars).toHaveLength(events.length);
    }
    expect(parseChordPro(NEW_SONG_TEXT).title).toBe('Yeni şarkı');
  });

  it('blues çalışması 12 ölçüdür', () => {
    const blues = BUILTIN_SONGS.find((s) => s.id === 'builtin:pazartesi-blues')!;
    expect(chordEvents(parseChordPro(blues.text)).map((e) => e.written)).toEqual([
      'A7', 'D7', 'A7', 'A7', 'D7', 'D7', 'A7', 'A7', 'E7', 'D7', 'A7', 'E7',
    ]);
  });
});
