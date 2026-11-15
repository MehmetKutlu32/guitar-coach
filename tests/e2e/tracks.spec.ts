import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

const rms = (page: Page) => page.evaluate(() => window.__gitar!.outputRms());
const outFreq = (page: Page) => page.evaluate(() => window.__gitar!.outputFreq());
const position = async (page: Page) => Number(await page.getByTestId('track-time').getAttribute('data-position'));

/** 16 bit mono WAV: her bölüm `seconds` saniye, verilen frekansta (harmonikli) ton. */
function wav(freqs: number[], seconds: number, sampleRate = 44100): Buffer {
  const n = Math.floor(freqs.length * seconds * sampleRate);
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + n * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(n * 2, 40);
  const perSection = Math.floor(seconds * sampleRate);
  for (let i = 0; i < n; i++) {
    const f = freqs[Math.min(freqs.length - 1, Math.floor(i / perSection))];
    let s = 0;
    for (let k = 1; k <= 3; k++) s += Math.sin((2 * Math.PI * f * k * i) / sampleRate) / (k * k);
    data.writeInt16LE(Math.round(s * 0.4 * 32767), 44 + i * 2);
  }
  return data;
}

/** Üç bölüm, ikişer saniye: 330 Hz, 440 Hz, 550 Hz. */
const FILE = { name: 'calisma_parcasi.wav', mimeType: 'audio/wav', buffer: wav([330, 440, 550], 2) };
const cents = (f: number, ref: number) => (f > 0 ? Math.abs(1200 * Math.log2(f / ref)) : Infinity);

/** Dalga formunda verilen saniyeye dokunur. */
async function seekTo(page: Page, seconds: number, duration = 6): Promise<void> {
  const wave = page.getByTestId('track-wave');
  const box = (await wave.boundingBox())!;
  await wave.click({ position: { x: (box.width * seconds) / duration, y: box.height / 2 } });
  await expect.poll(() => position(page)).toBeGreaterThan(seconds - 0.1);
  await expect.poll(() => position(page)).toBeLessThan(seconds + 0.6);
}

test('ses dosyası: yükleme, tonu bozmadan yavaşlatma, ton değiştirme', async ({ page }, info) => {
  await page.goto('./#/track');
  await expect(page.getByTestId('page-title')).toHaveText('Ses dosyası');
  await expect(page.getByTestId('track-empty')).toBeVisible();
  await expectHealthyLayout(page);

  await page.getByTestId('track-file').setInputFiles(FILE);
  await expect(page.getByTestId('track-name')).toHaveText('calisma parcasi', { timeout: 15_000 });
  await expect(page.getByTestId('track-time')).toContainText('0:00.0 / 0:06.0');
  expect(Number(await page.getByTestId('track-wave').getAttribute('data-max'))).toBeGreaterThan(30);
  await expect(page.getByTestId('track-item')).toHaveCount(1);
  await expectHealthyLayout(page);
  await shot(page, info, 'track-player', true);

  // Özgün hız: ilk bölüm 330 Hz; konum gerçek zamanla ilerler.
  await page.getByTestId('track-play').click();
  await expect(page.getByTestId('track-time')).toHaveAttribute('data-playing', 'true');
  await expect.poll(async () => cents(await outFreq(page), 330)).toBeLessThan(20);
  await page.getByTestId('track-play').click();
  await expect(page.getByTestId('track-time')).toHaveAttribute('data-playing', 'false');
  await expect.poll(() => rms(page)).toBeLessThan(0.003);

  // Yarı hız: perde aynı kalır (440 Hz bölümü), konum yarı hızla ilerler.
  await page.getByTestId('track-speed-50').click();
  await expect(page.getByTestId('track-speed')).toContainText('%50');
  await seekTo(page, 2.3);
  await page.getByTestId('track-play').click();
  await expect.poll(async () => cents(await outFreq(page), 440)).toBeLessThan(20);
  const p0 = await position(page);
  const t0 = Date.now();
  await page.waitForTimeout(1500);
  const p1 = await position(page);
  const rate = (p1 - p0) / ((Date.now() - t0) / 1000);
  console.log(`[ses dosyası] %50 hızda konum ilerleme hızı ${rate.toFixed(3)} (beklenen 0,5)`);
  expect(rate).toBeGreaterThan(0.42);
  expect(rate).toBeLessThan(0.58);
  // Hâlâ aynı bölümdeyiz ve perde hâlâ 440 Hz.
  const slow = await outFreq(page);
  console.log(`[ses dosyası] %50 hızda çıkış perdesi ${slow.toFixed(2)} Hz (özgün 440)`);
  expect(cents(slow, 440)).toBeLessThan(20);

  // Ton +2 yarım ton: 440 → 493,88 Hz; hız değişmez.
  const plus = page.getByTestId('track-pitch').getByRole('button', { name: '+' });
  await plus.click();
  await plus.click();
  await expect(page.getByTestId('track-pitch')).toContainText('+2 yarım ton');
  await seekTo(page, 2.2);
  await expect.poll(async () => cents(await outFreq(page), 493.88)).toBeLessThan(20);
  const shifted = await outFreq(page);
  console.log(`[ses dosyası] +2 yarım ton: çıkış ${shifted.toFixed(2)} Hz (beklenen 493,88)`);
  await page.getByTestId('track-play').click();
  await expectHealthyLayout(page);

  // Parça sonuna gelince durur.
  await page.getByTestId('track-speed-100').click();
  await seekTo(page, 5.5);
  await page.getByTestId('track-play').click();
  await expect(page.getByTestId('track-time')).toHaveAttribute('data-playing', 'false', { timeout: 8000 });
});

test('A–B döngüsü, ileri/geri, ayarların ve parçanın kalıcılığı, silme', async ({ page }, info) => {
  await page.goto('./#/track');
  await page.getByTestId('track-file').setInputFiles(FILE);
  await expect(page.getByTestId('track-name')).toHaveText('calisma parcasi', { timeout: 15_000 });
  await expect(page.getByTestId('track-loop-info')).toContainText('Döngü kapalı');

  // İleri / geri 5 saniye.
  await page.getByTestId('track-fwd').click();
  await expect.poll(() => position(page)).toBeGreaterThan(4.9);
  await page.getByTestId('track-back').click();
  await expect.poll(() => position(page)).toBeLessThan(0.2);

  // 440 Hz bölümünün içinde döngü: A ≈ 2,3 sn, B ≈ 3,7 sn.
  await seekTo(page, 2.3);
  await page.getByTestId('track-set-a').click();
  await seekTo(page, 3.7);
  await page.getByTestId('track-set-b').click();
  await expect(page.getByTestId('track-loop-info')).toContainText('Döngü: 0:02.');
  await expect(page.getByTestId('track-wave-region')).toBeVisible();
  await expectHealthyLayout(page);
  await shot(page, info, 'track-loop', true);

  // Çal: konum hep döngünün içinde, perde hep 440 Hz (550 Hz'lik bölüme hiç geçmez), döngü başa sarar.
  await seekTo(page, 2.4);
  await page.getByTestId('track-play').click();
  let wraps = 0;
  let last = await position(page);
  const started = Date.now();
  while (Date.now() - started < 4500) {
    const p = await position(page);
    expect(p).toBeGreaterThan(2.15);
    expect(p).toBeLessThan(3.85);
    if (p < last - 0.5) wraps++;
    last = p;
    const f = await outFreq(page);
    if (f > 0) expect(cents(f, 440)).toBeLessThan(40);
    await page.waitForTimeout(60);
  }
  expect(wraps).toBeGreaterThanOrEqual(2);
  expect(await rms(page)).toBeGreaterThan(0.01);
  await page.getByTestId('track-play').click();

  // Ayarlar parçayla birlikte saklanır.
  await page.getByTestId('track-speed-75').click();
  await page.getByTestId('track-pitch').getByRole('button', { name: '−' }).click();
  await expect(page.getByTestId('track-pitch')).toContainText('−1 yarım ton');
  // Yazma eşzamansız: veritabanına ulaştığını görmeden sayfayı yenileme.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number | null>((resolve, reject) => {
            const open = indexedDB.open('gitar-app');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const req = open.result.transaction('items', 'readonly').objectStore('items').getAll();
              req.onsuccess = () => {
                const row = (req.result as { type?: string; semitones?: number }[]).find((r) => r.type === 'track');
                open.result.close();
                resolve(row?.semitones ?? null);
              };
              req.onerror = () => reject(req.error);
            };
          }),
      ),
    )
    .toBe(-1);
  await page.reload();
  await expect(page.getByTestId('track-item')).toHaveCount(1);
  await expect(page.getByTestId('track-item')).toContainText('%75');
  await expect(page.getByTestId('track-player')).toHaveCount(0);
  await page.getByTestId('track-item').click();
  await expect(page.getByTestId('track-name')).toHaveText('calisma parcasi', { timeout: 15_000 });
  await expect(page.getByTestId('track-speed')).toContainText('%75');
  await expect(page.getByTestId('track-pitch')).toContainText('−1 yarım ton');
  await expect(page.getByTestId('track-loop-info')).toContainText('Döngü: 0:02.');
  // Konum döngünün başında; saklanan dosya çözülüp çalınır (440 Hz − 1 yarım ton = 415,3 Hz).
  expect(await position(page)).toBeGreaterThan(2.1);
  await page.getByTestId('track-play').click();
  await expect.poll(async () => cents(await outFreq(page), 415.3)).toBeLessThan(25);
  await page.getByTestId('track-play').click();

  // Döngüyü kaldır.
  await page.getByTestId('track-clear-loop').click();
  await expect(page.getByTestId('track-loop-info')).toContainText('Döngü kapalı');
  await expect(page.getByTestId('track-wave-region')).toHaveCount(0);

  // Silme.
  page.on('dialog', (d) => void d.accept());
  await page.getByTestId('track-delete').click();
  await expect(page.getByTestId('track-empty')).toBeVisible();
  await expect(page.getByTestId('track-player')).toHaveCount(0);
});

test('ses olmayan dosya anlaşılır bir hata verir', async ({ page }) => {
  await page.goto('./#/track');
  await page.getByTestId('track-file').setInputFiles({ name: 'notlar.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('bu bir ses dosyası değil') });
  await expect(page.getByTestId('track-error')).toContainText('Bu dosya açılamadı');
  await expect(page.getByTestId('track-player')).toHaveCount(0);
  await expect(page.getByTestId('track-empty')).toBeVisible();
  // Sonra geçerli bir dosya seçilebilir.
  await page.getByTestId('track-file').setInputFiles(FILE);
  await expect(page.getByTestId('track-name')).toHaveText('calisma parcasi', { timeout: 15_000 });
  await expect(page.getByTestId('track-error')).toHaveCount(0);
});
