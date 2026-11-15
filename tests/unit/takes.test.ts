import { describe, expect, it } from 'vitest';
import {
  computePeaks,
  cursorFraction,
  formatBytes,
  formatDuration,
  fromBase64,
  isTake,
  isTakeAudio,
  maxLevel,
  mixToMono,
  nextTakeNumber,
  quantizePeaks,
  rmsLevel,
  seekSeconds,
  toBase64,
  totalBytes,
  type Take,
} from '../../src/features/recorder/takes';

const take = (over: Partial<Take> = {}): Take => ({
  id: 'a',
  type: 'recording',
  date: 1,
  name: 'Kayıt 1',
  seconds: 3,
  peaks: [10, 50],
  peak: 0.5,
  mime: 'audio/webm',
  bytes: 1200,
  ...over,
});

describe('dalga formu', () => {
  it('her parçanın en büyük mutlak değerini verir', () => {
    const samples = new Float32Array([0, 0.2, -0.5, 0.1, 0.9, -0.3, 0, 0]);
    const peaks = computePeaks(samples, 4);
    expect(peaks).toHaveLength(4);
    expect(peaks[0]).toBeCloseTo(0.2);
    expect(peaks[1]).toBeCloseTo(0.5);
    expect(peaks[2]).toBeCloseTo(0.9);
    expect(peaks[3]).toBe(0);
  });

  it('sinüsün zarfını izler ve örnek sayısı parçadan azsa taşmaz', () => {
    const n = 48000;
    const samples = new Float32Array(n);
    // İlk yarı 0,8 genlikli, ikinci yarı 0,2 genlikli 220 Hz.
    for (let i = 0; i < n; i++) samples[i] = (i < n / 2 ? 0.8 : 0.2) * Math.sin((2 * Math.PI * 220 * i) / 48000);
    const peaks = computePeaks(samples, 100);
    expect(peaks).toHaveLength(100);
    for (let i = 0; i < 49; i++) expect(peaks[i]).toBeGreaterThan(0.79);
    for (let i = 51; i < 100; i++) expect(peaks[i]).toBeLessThan(0.21);
    expect(computePeaks(new Float32Array([0.3, -0.7]), 240)).toHaveLength(2);
    expect(computePeaks(new Float32Array(0), 10)).toEqual([0]);
    // Kırpılmış değerler 1'i aşmaz.
    expect(computePeaks(new Float32Array([1.7]), 1)).toEqual([1]);
  });

  it('saklama için 0–100 tam sayıya çevirir', () => {
    expect(quantizePeaks([0, 0.004, 0.5, 0.999, 1.4, -1])).toEqual([0, 0, 50, 100, 100, 0]);
  });

  it('seviye ölçümleri ve tek kanala indirme', () => {
    expect(maxLevel(new Float32Array([0.1, -0.6, 0.3]))).toBeCloseTo(0.6);
    expect(maxLevel(new Float32Array(0))).toBe(0);
    const sine = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 100 * i) / 48000));
    expect(rmsLevel(sine)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(rmsLevel(new Float32Array(0))).toBe(0);
    expect(Array.from(mixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 0, 1])]))).toEqual([0.5, 0, 0]);
    expect(mixToMono([])).toHaveLength(0);
  });
});

describe('base64', () => {
  it('ikili veriyi kayıpsız çevirir (büyük veri dahil)', () => {
    const bytes = new Uint8Array(200_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) % 256;
    const text = toBase64(bytes);
    expect(text).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const back = fromBase64(text);
    expect(back).toHaveLength(bytes.length);
    expect(back.every((v, i) => v === bytes[i])).toBe(true);
    expect(toBase64(new Uint8Array(0))).toBe('');
    expect(fromBase64('')).toHaveLength(0);
    // JSON'dan geçince de aynı kalır (dışa/içe aktarma).
    expect(fromBase64(JSON.parse(JSON.stringify({ a: toBase64(new Uint8Array([0, 255, 128])) })).a)).toEqual(new Uint8Array([0, 255, 128]));
  });
});

describe('biçimlendirme ve zamanlama', () => {
  it('süre ve boyut', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5.4)).toBe('0:05');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(-3)).toBe('0:00');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(48_300)).toBe('48 kB');
    expect(formatBytes(1_440_000)).toBe('1,4 MB');
    expect(formatBytes(1_440_000, '.')).toBe('1.4 MB');
  });

  it('dalga formundan konum ve karşılaştırma imleci', () => {
    expect(seekSeconds(0.5, 10)).toBe(5);
    expect(seekSeconds(-1, 10)).toBe(0);
    expect(seekSeconds(2, 10)).toBe(10);
    // 4 sn'lik ve 8 sn'lik iki kayıt birlikte çalınırken 6. saniye: kısa olan bitmiş, uzun olan dörtte üçünde.
    expect(cursorFraction(6, 4)).toBe(1);
    expect(cursorFraction(6, 8)).toBe(0.75);
    expect(cursorFraction(1, 0)).toBe(0);
  });

  it('yeni kayıt numarası ve toplam alan', () => {
    expect(nextTakeNumber([], 'Kayıt')).toBe(1);
    expect(nextTakeNumber([{ name: 'Kayıt 1' }, { name: 'Kayıt 4' }, { name: 'Blues solosu' }, { name: 'Kayıt 2b' }], 'Kayıt')).toBe(5);
    expect(nextTakeNumber([{ name: 'Take 2' }], 'Kayıt')).toBe(1);
    expect(totalBytes([take({ bytes: 1000 }), take({ bytes: 2500 })])).toBe(3500);
    expect(totalBytes([])).toBe(0);
  });
});

describe('kayıt biçimi', () => {
  it('geçerli kayıtları tanır', () => {
    expect(isTake(take())).toBe(true);
    expect(isTake({ ...take(), type: 'song' })).toBe(false);
    expect(isTake({ ...take(), peaks: 'x' })).toBe(false);
    expect(isTake(null)).toBe(false);
    expect(isTakeAudio({ id: 'a', type: 'recording', date: 1, mime: 'audio/webm', base64: 'AAAA' })).toBe(true);
    expect(isTakeAudio({ id: 'a', type: 'recording', mime: 'audio/webm' })).toBe(false);
  });
});
