/**
 * Hazır çalışma şarkıları. Sözler ve akor düzenleri bu uygulama için yazılmıştır;
 * hiçbir mevcut eserden alıntı içermez.
 */
export interface SongRecord {
  id: string;
  /** ChordPro metni. */
  text: string;
  bpm: number;
  transpose: number;
  capo: number;
  /** Her akor kaç vuruş sürer. */
  beatsPerChord: number;
  style: 'rock' | 'blues' | 'pop' | 'funk';
  builtin?: boolean;
}

export const BUILTIN_SONGS: SongRecord[] = [
  {
    id: 'builtin:dort-akor',
    builtin: true,
    bpm: 84,
    transpose: 0,
    capo: 0,
    beatsPerChord: 4,
    style: 'pop',
    text: `{title: İlk Dört Akor}
{artist: Çalışma şarkısı}
{key: G}
{tempo: 84}
{comment: Her akor bir ölçü. Önce yalnızca aşağı vuruşlarla çal.}

{start_of_verse}
[G]Parmaklarım yeni, [Em]teller biraz sert
[C]Dört akor yeter [D]başlamaya dert
[G]Sabah bir tur, [Em]akşam bir tur daha
[C]Her gün biraz, [D]acele etme asla
{end_of_verse}

{start_of_chorus}
[G]Çal, yavaş [Em]çal, temiz [C]çal
[D]Hız kendi gelir, sen [G]kal
{end_of_chorus}
`,
  },
  {
    id: 'builtin:pazartesi-blues',
    builtin: true,
    bpm: 92,
    transpose: 0,
    capo: 0,
    beatsPerChord: 4,
    style: 'blues',
    text: `{title: Pazartesi Blues}
{artist: Çalışma şarkısı}
{key: A}
{tempo: 92}
{comment: 12 ölçülük blues. Yedili akorları temiz bas.}

[A7]Pazartesi sabahı [D7]gitarım akortsuz
[A7]Kahvem soğumuş, [A7]kafam hâlâ uykusuz
[D7]Teller pas tutmuş, [D7]pena kaybolmuş
[A7]Yine de çalarım, [A7]başka yolu yokmuş
[E7]On iki ölçü döner, [D7]başa sarar
[A7]Bir tur daha çal, [E7]gün öyle başlar
`,
  },
  {
    id: 'builtin:sahil-yolu',
    builtin: true,
    bpm: 100,
    transpose: 0,
    capo: 0,
    beatsPerChord: 4,
    style: 'rock',
    text: `{title: Sahil Yolu}
{artist: Çalışma şarkısı}
{key: Am}
{tempo: 100}
{comment: Am – F – C – G döngüsü. F için küçük bare ya da tam bare dene.}

{start_of_verse}
[Am]Camı açtım, [F]rüzgâr doldu içeri
[C]Yol uzun ama [G]dönmem artık geri
[Am]Radyoda cızırtı, [F]elimde bir ritim
[C]Direksiyonda [G]tempo tutar gibiyim
{end_of_verse}

{start_of_chorus}
[F]Sahil yolu, [C]sahil yolu
[G]Dört akorla [Am]geçer bu yolu
[F]Bir daha çal, [C]bir daha dön
[G]Bitince başa [Am]sar yine sen
{end_of_chorus}
`,
  },
];

export const NEW_SONG_TEXT = `{title: Yeni şarkı}
{artist: }
{tempo: 90}

[Am]Sözleri buraya yaz, [F]akorları köşeli parantezle
[C]sözün içine [G]yerleştir
`;

export function isSongRecord(v: unknown): v is SongRecord {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<SongRecord>;
  return typeof s.id === 'string' && typeof s.text === 'string' && typeof s.bpm === 'number';
}
