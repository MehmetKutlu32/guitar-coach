// public/icons/icon.svg dosyasından PWA için PNG ikonları üretir.
// Kullanım: node scripts/gen-icons.mjs   (Playwright'ın Chromium'u gerekir)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'public', 'icons');
const svg = readFileSync(join(dir, 'icon.svg'), 'utf8');
const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

const targets = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  // Maskelenebilir ikon: içerik güvenli bölgede (ortadaki %80) kalır, zemin kenara kadar dolar.
  { file: 'icon-maskable-512.png', size: 512, pad: 0.12 },
];

const browser = await chromium.launch();
for (const t of targets) {
  const page = await browser.newPage({ viewport: { width: t.size, height: t.size }, deviceScaleFactor: 1 });
  const inner = Math.round(t.size * (1 - 2 * t.pad));
  await page.setContent(
    `<body style="margin:0;background:${t.pad ? '#0e1014' : 'transparent'};display:grid;place-items:center;height:100vh">
       <img src="${dataUrl}" width="${inner}" height="${inner}">
     </body>`,
  );
  await page.waitForFunction(() => document.images[0].complete);
  await page.screenshot({ path: join(dir, t.file), omitBackground: !t.pad });
  await page.close();
  console.log('wrote', t.file);
}
await browser.close();
