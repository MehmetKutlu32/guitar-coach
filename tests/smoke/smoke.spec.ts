import { expect, test } from '@playwright/test';

// Yayınlanmış siteye karşı temel duman testi (bkz. playwright.smoke.config.ts).
test('yayınlanan site açılır, PWA kurulabilir ve çevrimdışı çalışır', async ({ page, context, request }) => {
  await page.goto('./');
  await expect(page.getByTestId('page-title')).toHaveText('Gitar Çalışma');

  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifestUrl = new URL(href!, page.url()).href;
  const manifest = await (await request.get(manifestUrl)).json();
  expect(manifest.display).toBe('standalone');
  expect(new URL(manifest.start_url, manifestUrl).href).toBe(new URL('./', page.url()).href);

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('page-title')).toHaveText('Gitar Çalışma');
  await page.getByTestId('tool-tuner').click();
  await expect(page.getByTestId('tuner-start')).toBeVisible();
  await context.setOffline(false);
});
