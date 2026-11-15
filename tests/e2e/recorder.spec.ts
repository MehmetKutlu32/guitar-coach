import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot, useSyntheticInput } from './helpers';

const rms = (page: Page) => page.evaluate(() => window.__gitar!.outputRms());
const outFreq = (page: Page) => page.evaluate(() => window.__gitar!.outputFreq());

/** Sonraki kayıtlar için giriş sinyalinin frekansını değiştirir. */
async function setInputFreq(page: Page, freq: number): Promise<void> {
  await page.evaluate((f) => {
    (window as unknown as { __gitarTestInput: (ctx: AudioContext) => AudioNode }).__gitarTestInput = (ctx) => {
      const out = ctx.createGain();
      out.gain.value = 0.25;
      for (let k = 1; k <= 4; k++) {
        const osc = ctx.createOscillator();
        osc.frequency.value = f * k;
        const g = ctx.createGain();
        g.gain.value = 1 / (k * k);
        osc.connect(g).connect(out);
        osc.start();
      }
      return out;
    };
  }, freq);
}

/** Yaklaşık `seconds` saniyelik bir kayıt alır ve saklanmasını bekler. */
async function record(page: Page, seconds: number): Promise<void> {
  await page.getByTestId('rec-start').click();
  await expect(page.getByTestId('rec-clock')).toHaveAttribute('data-phase', 'recording');
  await expect(page.getByTestId('rec-clock')).toHaveText(new RegExp(`0:0${seconds}`), { timeout: 10_000 });
  await page.getByTestId('rec-stop').click();
  await expect(page.getByTestId('rec-start')).toBeVisible({ timeout: 10_000 });
}

test('kayıt alma: dalga formu, kayıt içeriği, çalma, konum, ad ve kalıcılık', async ({ page }, info) => {
  await useSyntheticInput(page, 220);
  await page.goto('./#/record');
  await expect(page.getByTestId('page-title')).toHaveText('Kayıt');
  await expect(page.getByTestId('rec-empty')).toBeVisible();
  await expectHealthyLayout(page);

  await page.getByTestId('rec-start').click();
  await expect(page.getByTestId('rec-clock')).toHaveAttribute('data-phase', 'recording');
  // Canlı seviye izi dolar.
  await expect.poll(async () => Number(await page.getByTestId('rec-live').getAttribute('data-max'))).toBeGreaterThan(5);
  await expect(page.getByTestId('rec-clock')).toHaveText(/0:02/, { timeout: 10_000 });
  await expectHealthyLayout(page);
  await shot(page, info, 'rec-recording');
  await page.getByTestId('rec-stop').click();

  // Kayıt saklandı ve seçildi.
  await expect(page.getByTestId('rec-name')).toHaveText('Kayıt 1', { timeout: 10_000 });
  await expect(page.getByTestId('rec-warning')).toHaveCount(0);
  await expect(page.getByTestId('rec-meta')).toContainText(/0:0[23]/);
  await expect(page.getByTestId('rec-take')).toHaveCount(1);
  await expect(page.getByTestId('rec-total')).toContainText('1 kayıt');
  expect(Number(await page.getByTestId('rec-wave-a').getAttribute('data-max'))).toBeGreaterThan(10);

  // Kaydın içeriği gerçekten giriş sinyali: 220 Hz, ~2 sn, sessiz değil.
  const id = (await page.getByTestId('rec-name').getAttribute('data-id'))!;
  const stats = await page.evaluate((takeId) => window.__gitar!.analyzeTake(takeId), id);
  console.log(`[kayıt] 220 Hz giriş → kayıtta ${stats.freq.toFixed(2)} Hz, ${stats.seconds.toFixed(2)} sn, rms ${stats.rms.toFixed(3)}`);
  expect(Math.abs(stats.freq - 220)).toBeLessThan(1.5);
  expect(stats.seconds).toBeGreaterThan(1.4);
  expect(stats.seconds).toBeLessThan(4);
  expect(stats.rms).toBeGreaterThan(0.02);
  await expectHealthyLayout(page);
  await shot(page, info, 'rec-detail', true);

  // Çalma: ses çıkar, perdesi kayıttakiyle aynı, imleç ilerler; kayıt bitince kendiliğinden durur.
  await page.getByTestId('rec-play').click();
  await expect(page.getByTestId('rec-play')).toHaveAttribute('data-playing', 'true');
  await expect.poll(() => rms(page)).toBeGreaterThan(0.01);
  await expect.poll(async () => Math.abs((await outFreq(page)) - 220)).toBeLessThan(3);
  await expect.poll(async () => Number(await page.getByTestId('rec-wave-a').getAttribute('data-cursor'))).toBeGreaterThan(0.2);
  await expect(page.getByTestId('rec-play')).toHaveAttribute('data-playing', 'false', { timeout: 8000 });
  await expect.poll(() => rms(page)).toBeLessThan(0.003);

  // Dalga formuna dokunarak konum seçme.
  const wave = page.getByTestId('rec-wave-a');
  const box = (await wave.boundingBox())!;
  await wave.click({ position: { x: box.width / 2, y: box.height / 2 } });
  const cursor = Number(await wave.getAttribute('data-cursor'));
  expect(cursor).toBeGreaterThan(0.45);
  expect(cursor).toBeLessThan(0.55);

  // Ad değiştirme.
  await page.getByTestId('rec-rename').click();
  await page.getByTestId('rec-name-input').fill('Blues solosu');
  await page.getByTestId('rec-name-save').click();
  await expect(page.getByTestId('rec-name')).toHaveText('Blues solosu');
  await expect(page.getByTestId('rec-take')).toContainText('Blues solosu');

  // Kayıt kalıcı: sayfa yenilenince veritabanından çözülüp çalınır.
  await page.reload();
  await expect(page.getByTestId('rec-take')).toHaveCount(1);
  await page.getByTestId('rec-take').click();
  await expect(page.getByTestId('rec-name')).toHaveText('Blues solosu');
  await page.getByTestId('rec-play').click();
  await expect.poll(async () => Math.abs((await outFreq(page)) - 220)).toBeLessThan(3);
  await page.getByTestId('rec-play').click();
  await expect(page.getByTestId('rec-play')).toHaveAttribute('data-playing', 'false');
});

test('iki kaydı yan yana dinleme (A/B) ve silme', async ({ page }, info) => {
  await useSyntheticInput(page, 220);
  await page.goto('./#/record');
  await record(page, 3);
  await expect(page.getByTestId('rec-name')).toHaveText('Kayıt 1', { timeout: 10_000 });
  // Tek kayıt varken karşılaştırma seçeneği yok.
  await expect(page.getByTestId('rec-compare')).toHaveCount(0);

  await setInputFreq(page, 330);
  await record(page, 3);
  await expect(page.getByTestId('rec-name')).toHaveText('Kayıt 2', { timeout: 10_000 });
  await expect(page.getByTestId('rec-take')).toHaveCount(2);

  // Yeni kayıt (A, 330 Hz) eski kayıtla (B, 220 Hz) karşılaştırılır.
  await page.getByTestId('rec-compare').selectOption({ index: 1 });
  await expect(page.getByTestId('rec-wave-b')).toBeVisible();
  await expect(page.getByTestId('rec-ab')).toBeVisible();
  await expectHealthyLayout(page);
  await shot(page, info, 'rec-compare', true);

  // Önce B'yi dinle, çalarken A'ya geç: ses aynı konumdan diğer kayda döner.
  await page.getByTestId('rec-ab').getByRole('radio', { name: 'B' }).click();
  await page.getByTestId('rec-play').click();
  await expect.poll(async () => Math.abs((await outFreq(page)) - 220)).toBeLessThan(3);
  const before = Number(await page.getByTestId('rec-wave-a').getAttribute('data-cursor'));
  await page.getByTestId('rec-ab').getByRole('radio', { name: 'A' }).click();
  await expect.poll(async () => Math.abs((await outFreq(page)) - 330)).toBeLessThan(4);
  // Geçişte çalma baştan başlamaz; iki dalga formunda da imleç ilerler.
  const after = Number(await page.getByTestId('rec-wave-a').getAttribute('data-cursor'));
  expect(after).toBeGreaterThan(before);
  expect(Number(await page.getByTestId('rec-wave-b').getAttribute('data-cursor'))).toBeGreaterThan(0);
  await page.getByTestId('rec-play').click();
  await expect.poll(() => rms(page)).toBeLessThan(0.003);

  // Ses verisi JSON'a uygun (base64 metin) saklanır: dışa aktarmada bozulmaz.
  const stored = await page.evaluate(
    () =>
      new Promise<{ count: number; text: boolean }>((resolve, reject) => {
        const open = indexedDB.open('gitar-app');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('blobs', 'readonly').objectStore('blobs').getAll();
          req.onsuccess = () => {
            const rows = req.result as { base64?: unknown }[];
            open.result.close();
            resolve({ count: rows.length, text: rows.every((r) => typeof r.base64 === 'string' && (r.base64 as string).length > 1000) });
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
  expect(stored).toEqual({ count: 2, text: true });

  // Silme: kayıt ve ses verisi birlikte gider.
  page.on('dialog', (d) => void d.accept());
  await page.getByTestId('rec-delete').click();
  await expect(page.getByTestId('rec-take')).toHaveCount(1);
  await expect(page.getByTestId('rec-detail')).toHaveCount(0);
  await expect(page.getByTestId('rec-take')).toContainText('Kayıt 1');
  const left = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('gitar-app');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('blobs', 'readonly').objectStore('blobs').count();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
  expect(left).toBe(1);
});

test('vazgeçilen kayıt saklanmaz; sessiz kayıtta uyarı verilir', async ({ page }) => {
  await useSyntheticInput(page, 220, 0);
  await page.goto('./#/record');
  await page.getByTestId('rec-start').click();
  await expect(page.getByTestId('rec-clock')).toHaveAttribute('data-phase', 'recording');
  await page.getByTestId('rec-cancel').click();
  await expect(page.getByTestId('rec-start')).toBeVisible();
  await expect(page.getByTestId('rec-empty')).toBeVisible();

  await record(page, 1);
  await expect(page.getByTestId('rec-warning')).toContainText('ses yok gibi görünüyor', { timeout: 10_000 });
  await expect(page.getByTestId('rec-take')).toHaveCount(1);
  await expectHealthyLayout(page);
});
