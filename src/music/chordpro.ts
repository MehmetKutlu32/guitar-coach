import { chordAtBeat, type Bar, type ProgChord } from './progressions';
import { chordSymbol, COMMON_NAMES, mod12, parseChord, transposeChord } from './theory';

/** ChordPro biçimindeki şarkı metni için ayrıştırıcı ve zaman çizelgesi (saf). */

export interface Segment {
  /** Bu parçanın üstünde gösterilecek akor (yazıldığı gibi); yoksa undefined. */
  chord?: string;
  text: string;
}

export type SongLine =
  | { type: 'lyrics'; segments: Segment[]; section?: SectionKind }
  | { type: 'comment'; text: string }
  | { type: 'section'; kind: SectionKind; label: string }
  | { type: 'empty' };

export type SectionKind = 'chorus' | 'verse' | 'bridge';

export interface Song {
  title: string;
  artist: string;
  key: string;
  /** Metinde `{tempo: …}` verilmişse. */
  tempo: number | null;
  capo: number | null;
  lines: SongLine[];
}

const DIRECTIVE = /^\{\s*([a-zA-Z_]+)\s*(?::\s*(.*?))?\s*\}$/;

const SECTION_START: Record<string, SectionKind> = {
  start_of_chorus: 'chorus',
  soc: 'chorus',
  start_of_verse: 'verse',
  sov: 'verse',
  start_of_bridge: 'bridge',
  sob: 'bridge',
};
const SECTION_END = new Set(['end_of_chorus', 'eoc', 'end_of_verse', 'eov', 'end_of_bridge', 'eob']);

/** Bir söz satırını akor–metin parçalarına böler: "[Am]Merhaba [C]dünya". */
export function parseLine(line: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\[([^\]]*)\]/g;
  let last = 0;
  let chord: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    const text = line.slice(last, m.index);
    if (text || chord !== undefined) segments.push({ chord, text });
    chord = m[1].trim();
    last = m.index + m[0].length;
  }
  const rest = line.slice(last);
  if (rest || chord !== undefined) segments.push({ chord, text: rest });
  return segments;
}

/** ChordPro metnini ayrıştırır. Tanınmayan yönergeler yok sayılır. */
export function parseChordPro(text: string): Song {
  const song: Song = { title: '', artist: '', key: '', tempo: null, capo: null, lines: [] };
  let section: SectionKind | undefined;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) continue;
    if (trimmed === '') {
      // Art arda boş satırlar tek boşluğa iner; baştaki boşluk atlanır.
      const prev = song.lines[song.lines.length - 1];
      if (prev && prev.type !== 'empty') song.lines.push({ type: 'empty' });
      continue;
    }
    const d = DIRECTIVE.exec(trimmed);
    if (d) {
      const name = d[1].toLowerCase();
      const value = d[2] ?? '';
      if (name === 'title' || name === 't') song.title = value;
      else if (name === 'artist' || name === 'subtitle' || name === 'st') song.artist = value;
      else if (name === 'key') song.key = value;
      else if (name === 'tempo') {
        const n = parseInt(value, 10);
        if (Number.isFinite(n) && n > 0) song.tempo = n;
      } else if (name === 'capo') {
        const n = parseInt(value, 10);
        if (Number.isFinite(n) && n >= 0) song.capo = Math.min(11, n);
      } else if (name === 'comment' || name === 'c' || name === 'comment_italic' || name === 'ci') {
        song.lines.push({ type: 'comment', text: value });
      } else if (SECTION_START[name]) {
        section = SECTION_START[name];
        song.lines.push({ type: 'section', kind: section, label: value });
      } else if (SECTION_END.has(name)) {
        section = undefined;
      }
      continue;
    }
    song.lines.push({ type: 'lyrics', segments: parseLine(line), section });
  }
  while (song.lines.length && song.lines[song.lines.length - 1].type === 'empty') song.lines.pop();
  return song;
}

export interface ChordEvent {
  /** `song.lines` içindeki satır. */
  line: number;
  /** Satırdaki parça. */
  segment: number;
  /** Yazıldığı gibi akor. */
  written: string;
  /** Çalınabilir (tanınan) akor mu. */
  playable: boolean;
}

/** Şarkıdaki akorlar, sırayla. */
export function chordEvents(song: Song): ChordEvent[] {
  const out: ChordEvent[] = [];
  song.lines.forEach((line, li) => {
    if (line.type !== 'lyrics') return;
    line.segments.forEach((seg, si) => {
      if (seg.chord) out.push({ line: li, segment: si, written: seg.chord, playable: parseChord(seg.chord) !== null });
    });
  });
  return out;
}

/** Gösterilecek akor adı: transpoze edilmiş ve kapoya göre düşürülmüş (parmakla basılan biçim). */
export function shownChord(written: string, transpose: number, capo: number): string {
  return transposeChord(written, transpose - capo, COMMON_NAMES);
}

/** Duyulan akor: transpoze edilmiş, kapodan bağımsız. */
export function soundingChord(written: string, transpose: number): string {
  return transposeChord(written, transpose, COMMON_NAMES);
}

function toProgChord(symbol: string): ProgChord | null {
  const p = parseChord(symbol);
  return p ? { root: p.root, quality: p.quality, symbol: chordSymbol(p.root, p.quality, COMMON_NAMES) } : null;
}

export interface SongTimeline {
  /** Eşlik için ölçüler. */
  bars: Bar[];
  /** Zaman çizelgesindeki her adımın (akorun) `chordEvents` içindeki sırası. */
  steps: number[];
  beatsPerChord: number;
}

/**
 * Şarkının akorlarından çalınabilir bir zaman çizelgesi kurar.
 * ChordPro süre bilgisi taşımaz; her akor `beatsPerChord` vuruş sürer (1, 2, 4 ya da 8).
 * Tanınmayan akorlar atlanır.
 */
export function buildTimeline(song: Song, transpose: number, beatsPerChord: number): SongTimeline {
  const events = chordEvents(song);
  const steps: number[] = [];
  const beats: ProgChord[] = [];
  events.forEach((e, i) => {
    const chord = toProgChord(soundingChord(e.written, transpose));
    if (!chord) return;
    steps.push(i);
    for (let b = 0; b < beatsPerChord; b++) beats.push(chord);
  });
  // Son ölçü eksikse son akorla tamamlanır.
  while (beats.length % 4 !== 0) beats.push(beats[beats.length - 1]);
  const bars: Bar[] = [];
  for (let i = 0; i < beats.length; i += 4) {
    const [a, b, c, d] = beats.slice(i, i + 4);
    if (a.symbol === b.symbol && b.symbol === c.symbol && c.symbol === d.symbol) bars.push([a]);
    else if (a.symbol === b.symbol && c.symbol === d.symbol) bars.push([a, c]);
    else bars.push([a, b, c, d]);
  }
  return { bars, steps, beatsPerChord };
}

/** Çalma konumundan (ölçü, vuruş) o an çalınan akorun `chordEvents` sırası; yoksa -1. */
export function eventAt(timeline: SongTimeline, bar: number, beat: number): number {
  const step = Math.floor((bar * 4 + beat) / timeline.beatsPerChord);
  return timeline.steps[Math.min(step, timeline.steps.length - 1)] ?? -1;
}

/** Şarkıda geçen akorlar (gösterildiği biçimde), ilk görülme sırasıyla ve tekrarsız. */
export function uniqueChords(song: Song, transpose: number, capo: number): string[] {
  const seen = new Set<string>();
  for (const e of chordEvents(song)) {
    if (e.playable) seen.add(shownChord(e.written, transpose, capo));
  }
  return [...seen];
}

/** Şarkının tahmini tonu: `{key}` yönergesi varsa o, yoksa ilk akor. */
export function songKeyRoot(song: Song): number | null {
  const fromKey = parseChord(song.key);
  if (fromKey) return fromKey.root;
  const first = chordEvents(song).find((e) => e.playable);
  return first ? parseChord(first.written)!.root : null;
}

/** Vuruş başına süreyi ve toplam uzunluğu hesaplar (saniye). */
export function timelineSeconds(timeline: SongTimeline, bpm: number): number {
  return (timeline.bars.length * 4 * 60) / bpm;
}

export { chordAtBeat, mod12 };
