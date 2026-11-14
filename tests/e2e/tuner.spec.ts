import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot, useSyntheticInput } from './helpers';

async function readCents(page: Page): Promise<number> {
  const el = page.getByTestId('tuner-cents');
  await expect(el).not.toHaveAttribute('data-cents', '');
  return parseFloat((await el.getAttribute('data-cents'))!);
}

test('sahte mikrofondaki A2 (110 Hz) tonunu doğru gösterir', async ({ page }, info) => {
  await page.goto('./#/tuner');
  await expectHealthyLayout(page);
  await shot(page, info, 'tuner-idle');

  await page.getByTestId('tuner-start').click();
  await expect(page.getByTestId('tuner-note')).toHaveText('A2');
  await expect(page.getByTestId('tuner-hint')).toHaveText('Akortlu');
  expect(Math.abs(await readCents(page))).toBeLessThan(3);
  // Giriş seviyesi göstergesi sinyali görüyor.
  await expect
    .poll(async () => Number(await page.getByTestId('level-meter').getAttribute('aria-valuenow')))
    .toBeGreaterThan(30);
  // 5. tel (A) etkin olarak işaretlenir ve yarım saniye sonra "akortlandı" olur.
  await expect(page.getByTestId('string-1')).toHaveClass(/active/);
  await expect(page.getByTestId('string-1')).toHaveClass(/tuned/);
  await expectHealthyLayout(page);
  await shot(page, info, 'tuner-in-tune');

  await page.getByTestId('tuner-stop').click();
  await expect(page.getByTestId('tuner-start')).toBeVisible();
  await expect(page.getByTestId('tuner-note')).toHaveText('–');
});

test('18 cent tiz E2 telini ölçer; tele kilitlenince hedef değişir', async ({ page }, info) => {
  const target = 82.4069 * Math.pow(2, 18 / 1200);
  await useSyntheticInput(page, target);
  await page.goto('./#/tuner');
  await page.getByTestId('tuner-start').click();

  await expect(page.getByTestId('tuner-note')).toHaveText('E2');
  await expect(page.getByTestId('tuner-hint')).toHaveText('Tiz — gevşet');
  const cents = await readCents(page);
  expect(cents).toBeGreaterThan(16);
  expect(cents).toBeLessThan(20);
  await expect(page.getByTestId('string-0')).toHaveClass(/active/);
  await shot(page, info, 'tuner-sharp');

  // A teline kilitlen: aynı ses artık A2'ye göre çok pes.
  await page.getByTestId('string-1').click();
  await expect(page.getByTestId('string-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tuner-note')).toHaveText('A2');
  await expect(page.getByTestId('tuner-hint')).toHaveText('Pes — sık');
  expect(await readCents(page)).toBeLessThan(-400);

  // Kilidi kaldır: yeniden otomatik algılama.
  await page.getByTestId('string-1').click();
  await expect(page.getByTestId('tuner-note')).toHaveText('E2');
});

test('Drop D ve kromatik akort düzenleri', async ({ page }) => {
  await useSyntheticInput(page, 73.416); // D2
  await page.goto('./#/tuner');
  await page.getByTestId('tuner-start').click();

  // Standart akortta en yakın tel E2; D2 ona göre ~2 yarım ton pes.
  await expect(page.getByTestId('tuner-note')).toHaveText('E2');
  expect(await readCents(page)).toBeLessThan(-150);

  await page.getByTestId('tuning-select').selectOption('dropD');
  await expect(page.getByTestId('tuner-note')).toHaveText('D2');
  await expect(page.getByTestId('tuner-hint')).toHaveText('Akortlu');

  await page.getByTestId('tuning-select').selectOption('chromatic');
  await expect(page.getByTestId('strings')).toHaveCount(0);
  await expect(page.getByTestId('tuner-note')).toHaveText('D2');

  // Seçim kalıcıdır.
  await page.reload();
  await expect(page.getByTestId('tuning-select')).toHaveValue('chromatic');
});

test('mikrofon izni reddedilirse anlaşılır bir hata gösterilir', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await page.goto('./#/tuner');
  await page.getByTestId('tuner-start').click();
  await expect(page.getByTestId('input-error')).toContainText('Mikrofon izni verilmedi');
  await expect(page.getByTestId('tuner-start')).toBeEnabled();
});
