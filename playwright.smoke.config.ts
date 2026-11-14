import { defineConfig } from '@playwright/test';

// Yayınlanmış siteye karşı duman testi:  SMOKE_URL=https://kullanici.github.io/gitar-app/ npm run smoke
const url = process.env.SMOKE_URL;
if (!url) throw new Error('SMOKE_URL ortam değişkeni gerekli (ör. https://kullanici.github.io/gitar-app/)');

export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: url.endsWith('/') ? url : url + '/', browserName: 'chromium' },
});
