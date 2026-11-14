import { expect, test } from '@playwright/test';
import { BASE_PATH } from './helpers';

test('manifest ve ikonlar geçerli', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel=manifest]').getAttribute('href');
  const manifestUrl = new URL(href!, page.url()).href;
  const res = await request.get(manifestUrl);
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  // start_url ve scope, uygulamanın yayınlandığı alt dizine çözülmeli.
  expect(new URL(manifest.start_url, manifestUrl).pathname).toBe(BASE_PATH);
  expect(new URL(manifest.scope, manifestUrl).pathname).toBe(BASE_PATH);
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  for (const icon of manifest.icons) {
    const iconRes = await request.get(new URL(icon.src, manifestUrl).href);
    expect(iconRes.ok(), icon.src).toBe(true);
    expect(iconRes.headers()['content-type']).toContain('image/png');
  }
});

test('service worker kurulur ve uygulama çevrimdışı açılır', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // SW sayfayı denetlemeye başlasın (clients.claim).
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.scope);
  expect(new URL(scope).pathname).toBe(BASE_PATH);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('page-title')).toHaveText('Gitar Çalışma');
  // Çevrimdışıyken başka bir ekrana geçiş ve ses analiz modülünün (worklet) yüklenmesi.
  await page.getByTestId('tool-tuner').click();
  await page.getByTestId('tuner-start').click();
  await expect(page.getByTestId('tuner-note')).toHaveText('A2');

  await page.goto('./#/settings');
  await expect(page.getByTestId('offline-ready')).toBeVisible();
  await context.setOffline(false);
});
