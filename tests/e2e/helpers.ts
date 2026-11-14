import { expect, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
export const FAKE_MIC_WAV = join(here, '.tmp', 'fake-mic-a2.wav');
export const FAKE_MIC_FREQ = 110;
/** Uygulamanın yayınlandığı alt dizin (vite.config.ts ile aynı kaynak). */
export const BASE_PATH = process.env.BASE_PATH ?? '/gitar-app/';

/** Chromium'un sahte mikrofonu için 16 bit mono WAV yazar (harmonikli, tam periyotlu ton). */
export function writeFakeMicWav(): void {
  const sampleRate = 48000;
  const seconds = 2;
  const n = sampleRate * seconds;
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
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 1; k <= 5; k++) s += Math.sin((2 * Math.PI * FAKE_MIC_FREQ * k * i) / sampleRate) / (k * k);
    data.writeInt16LE(Math.round(s * 0.35 * 32767), 44 + i * 2);
  }
  mkdirSync(dirname(FAKE_MIC_WAV), { recursive: true });
  writeFileSync(FAKE_MIC_WAV, data);
}

/** Ekran görüntüsünü screenshots/<proje>/<ad>.png olarak kaydeder. */
export async function shot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  const path = join(ROOT, 'screenshots', info.project.name, `${name}.png`);
  await page.screenshot({ path, fullPage });
}

/** Yatay taşma olmamalı; dokunma hedefleri yeterince büyük olmalı. */
export async function expectHealthyLayout(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - window.innerWidth;
    const small: string[] = [];
    const clipped: string[] = [];
    const targets = document.querySelectorAll<HTMLElement>('button, a[href], select, input:not([type=hidden]), [role=button]');
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden' || style.display === 'none') continue;
      const label = `${el.tagName.toLowerCase()}[${el.dataset.testid ?? el.textContent?.trim().slice(0, 20)}] ${Math.round(r.width)}x${Math.round(r.height)}`;
      if (r.width < 44 || r.height < 44) small.push(label);
      if (r.left < -1 || r.right > window.innerWidth + 1) clipped.push(label);
    }
    return { overflow, small, clipped };
  });
  expect(report.overflow, 'yatay taşma (px)').toBeLessThanOrEqual(1);
  expect(report.clipped, 'ekran dışına taşan denetimler').toEqual([]);
  expect(report.small, '44px altı dokunma hedefleri').toEqual([]);
}

/** getUserMedia yerine sayfada üretilen harmonikli bir tonu giriş olarak kullanır. */
export async function useSyntheticInput(page: Page, freq: number, gain = 0.25): Promise<void> {
  await page.addInitScript(
    ({ freq, gain }) => {
      (window as unknown as { __gitarTestInput: (ctx: AudioContext) => AudioNode }).__gitarTestInput = (ctx) => {
        const out = ctx.createGain();
        out.gain.value = gain;
        for (let k = 1; k <= 4; k++) {
          const osc = ctx.createOscillator();
          osc.frequency.value = freq * k;
          const g = ctx.createGain();
          g.gain.value = 1 / (k * k);
          osc.connect(g).connect(out);
          osc.start();
        }
        return out;
      };
    },
    { freq, gain },
  );
}
