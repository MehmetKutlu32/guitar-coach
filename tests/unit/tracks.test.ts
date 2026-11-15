import { describe, expect, it } from 'vitest';
import {
  checkLength,
  checkSize,
  clampShift,
  clampSpeed,
  formatClock,
  isTrack,
  isTrackAudio,
  loopActive,
  MAX_FILE_BYTES,
  MAX_TRACK_SECONDS,
  setLoopEnd,
  setLoopStart,
  shiftLabel,
  skipTo,
  trackName,
} from '../../src/features/tracks/logic';

describe('ses dosyası: ad, sınırlar, gösterim', () => {
  it('dosya adından parça adı üretir', () => {
    expect(trackName('blues_solo_take2.mp3')).toBe('blues solo take2');
    expect(trackName('Şarkı.final.WAV')).toBe('Şarkı.final');
    expect(trackName('adsız')).toBe('adsız');
    expect(trackName('.mp3')).toBe('.mp3');
    expect(trackName('x'.repeat(200) + '.ogg')).toHaveLength(80);
  });

  it('boyut ve süre sınırları', () => {
    expect(checkSize(MAX_FILE_BYTES)).toBeNull();
    expect(checkSize(MAX_FILE_BYTES + 1)).toBe('tooBig');
    expect(checkLength(MAX_TRACK_SECONDS)).toBeNull();
    expect(checkLength(MAX_TRACK_SECONDS + 0.5)).toBe('tooLong');
  });

  it('hız ve ton sınırlanır, hız 5’in katına yuvarlanır', () => {
    expect(clampSpeed(100)).toBe(100);
    expect(clampSpeed(52)).toBe(50);
    expect(clampSpeed(5)).toBe(25);
    expect(clampSpeed(900)).toBe(150);
    expect(clampShift(2.4)).toBe(2);
    expect(clampShift(-40)).toBe(-12);
    expect(clampShift(13)).toBe(12);
  });

  it('konum ve yarım ton yazımı', () => {
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(65.34)).toBe('1:05.3');
    expect(formatClock(59.96)).toBe('1:00.0');
    expect(formatClock(-2)).toBe('0:00.0');
    expect(shiftLabel(0)).toBe('0');
    expect(shiftLabel(3)).toBe('+3');
    expect(shiftLabel(-2)).toBe('−2');
  });
});

describe('A–B döngüsü', () => {
  const none = { a: null, b: null };

  it('iki uç da belli ve arası yeterince uzunsa etkindir', () => {
    expect(loopActive(none)).toBe(false);
    expect(loopActive({ a: 1, b: null })).toBe(false);
    expect(loopActive({ a: 1, b: 1.1 })).toBe(false);
    expect(loopActive({ a: 1, b: 3 })).toBe(true);
  });

  it('A sonra B ile döngü kurulur', () => {
    const a = setLoopStart(none, 2.5, 10);
    expect(a).toEqual({ a: 2.5, b: null });
    expect(setLoopEnd(a, 6, 10)).toEqual({ a: 2.5, b: 6 });
  });

  it('A verilmeden B: parçanın başından B’ye', () => {
    expect(setLoopEnd(none, 4, 10)).toEqual({ a: 0, b: 4 });
  });

  it('B, A’nın gerisine ya da çok yakınına konamaz', () => {
    const loop = { a: 5, b: null };
    expect(setLoopEnd(loop, 4, 10)).toBe(loop);
    expect(setLoopEnd(loop, 5.1, 10)).toBe(loop);
    const full = { a: 5, b: 8 };
    expect(setLoopEnd(full, 3, 10)).toBe(full);
  });

  it('A, B’nin ilerisine taşınırsa B silinir; geride kalırsa B korunur', () => {
    expect(setLoopStart({ a: 2, b: 6 }, 7, 10)).toEqual({ a: 7, b: null });
    expect(setLoopStart({ a: 2, b: 6 }, 5.9, 10)).toEqual({ a: 5.9, b: null });
    expect(setLoopStart({ a: 2, b: 6 }, 4, 10)).toEqual({ a: 4, b: 6 });
  });

  it('uçlar parça süresine sığdırılır', () => {
    expect(setLoopStart(none, -3, 10)).toEqual({ a: 0, b: null });
    expect(setLoopEnd({ a: 2, b: null }, 99, 10)).toEqual({ a: 2, b: 10 });
  });

  it('ileri/geri atlama parça içinde, döngü etkinse döngü içinde kalır', () => {
    expect(skipTo(3, -5, 60, none)).toBe(0);
    expect(skipTo(58, 5, 60, none)).toBe(60);
    expect(skipTo(20, 5, 60, none)).toBe(25);
    expect(skipTo(12, -5, 60, { a: 10, b: 14 })).toBe(10);
    expect(skipTo(12, 5, 60, { a: 10, b: 14 })).toBeCloseTo(13.95);
  });
});

describe('kayıt biçimi', () => {
  it('geçerli parçaları tanır', () => {
    const track = {
      id: 'a',
      type: 'track',
      date: 1,
      name: 'x',
      seconds: 3,
      peaks: [1],
      mime: 'audio/mpeg',
      bytes: 10,
      speed: 100,
      semitones: 0,
      loopA: null,
      loopB: null,
    };
    expect(isTrack(track)).toBe(true);
    expect(isTrack({ ...track, type: 'recording' })).toBe(false);
    expect(isTrack({ ...track, speed: undefined })).toBe(false);
    expect(isTrack(undefined)).toBe(false);
    expect(isTrackAudio({ id: 'a', type: 'track', date: 1, mime: 'audio/mpeg', base64: 'AA==' })).toBe(true);
    expect(isTrackAudio({ id: 'a', type: 'recording', base64: 'AA==' })).toBe(false);
  });
});
