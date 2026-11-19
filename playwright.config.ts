import { defineConfig } from '@playwright/test';
import { BASE_PATH, FAKE_MIC_WAV, writeFakeMicWav } from './tests/e2e/helpers';

// Chromium'un sahte mikrofonu bu dosyayı döngüde çalar (gerçek getUserMedia yolu test edilir).
writeFakeMicWav();

// Birden çok çalışma kopyasında (git worktree) testleri aynı anda koşturmak için E2E_PORT verilebilir.
const PORT = Number(process.env.E2E_PORT ?? 4173);
const BASE = `http://localhost:${PORT}${BASE_PATH}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: BASE,
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
    {
      name: 'desktop',
      use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } },
    },
  ],
});
