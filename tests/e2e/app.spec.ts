import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expectHealthyLayout, shot } from './helpers';

test('ana sayfa açılır, Türkçe varsayılan, araç kartından akorda gidilir', async ({ page }, info) => {
  await page.goto('./');
  await expect(page.getByTestId('page-title')).toHaveText('Gitar Çalışma');
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expectHealthyLayout(page);
  await shot(page, info, 'home');

  await page.getByTestId('tool-tuner').click();
  await expect(page.getByTestId('page-title')).toHaveText('Akort');
  await expect(page).toHaveURL(/#\/tuner$/);
});

test('dil İngilizceye çevrilir ve yeniden açılışta korunur', async ({ page }, info) => {
  await page.goto('./#/settings');
  await expect(page.getByTestId('page-title')).toHaveText('Ayarlar');
  await expectHealthyLayout(page);
  await shot(page, info, 'settings');

  await page.getByTestId('lang').getByRole('radio', { name: 'English' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Settings');
  await expect(page.getByTestId('nav-tuner')).toContainText('Tuner');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.reload();
  await expect(page.getByTestId('page-title')).toHaveText('Settings');
});

test('veriler JSON olarak dışa aktarılır ve geri yüklenir', async ({ page }) => {
  await page.goto('./#/settings');
  // A4'ü değiştir ki dışa aktarılan dosyada varsayılandan farklı bir değer olsun.
  await page.getByTestId('a4').getByRole('button', { name: '+' }).click();
  await expect(page.getByTestId('a4').locator('output')).toHaveText('441 Hz');

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^gitar-yedek-\d{4}-\d{2}-\d{2}\.json$/);
  const path = await download.path();
  const data = JSON.parse(readFileSync(path, 'utf8'));
  expect(data.app).toBe('gitar-app');
  const saved = data.stores.kv.find((r: { key: string }) => r.key === 'settings');
  expect(saved.value.a4).toBe(441);

  // Değeri boz, sonra yedeği geri yükle.
  await page.getByTestId('a4').getByRole('button', { name: '−' }).click();
  await page.getByTestId('a4').getByRole('button', { name: '−' }).click();
  await expect(page.getByTestId('a4').locator('output')).toHaveText('439 Hz');
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('import-file').setInputFiles(path);
  await expect(page.getByTestId('data-message')).toHaveText('Veriler içe aktarıldı.');
  await expect(page.getByTestId('a4').locator('output')).toHaveText('441 Hz');
});

test('bozuk dosya içe aktarılırken hata gösterilir', async ({ page }) => {
  await page.goto('./#/settings');
  await page.getByTestId('import-file').setInputFiles({
    name: 'bozuk.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"merhaba": 1}'),
  });
  await expect(page.getByTestId('data-message')).toContainText('Dosya okunamadı');
});
