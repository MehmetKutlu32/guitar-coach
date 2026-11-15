import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

// Akor biçimlerinin çaldığı notalar (MIDI), kalın telden inceye.
const AM = [45, 52, 57, 60, 64];
const C = [48, 52, 55, 60, 64];
const G = [43, 47, 50, 55, 59, 67];

/** Giriş olarak, testin istediği akoru (harmonikli tonlarla) çalan bir kaynak kurar. */
async function useChordInput(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __gitarTestInput: (ctx: AudioContext) => AudioNode;
      __playChord: (midis: number[]) => void;
    };
    let pending: number[] = [];
    w.__playChord = (midis) => {
      pending = midis;
    };
    w.__gitarTestInput = (ctx) => {
      const out = ctx.createGain();
      out.gain.value = 0.3;
      let voices: OscillatorNode[] = [];
      w.__playChord = (midis) => {
        for (const v of voices) v.stop();
        voices = [];
        for (const midi of midis) {
          const f = 440 * Math.pow(2, (midi - 69) / 12);
          for (let h = 1; h <= 3; h++) {
            const osc = ctx.createOscillator();
            osc.frequency.value = f * h;
            const g = ctx.createGain();
            g.gain.value = 1 / (h * h) / midis.length;
            osc.connect(g).connect(out);
            osc.start();
            voices.push(osc);
          }
        }
      };
      w.__playChord(pending);
      return out;
    };
  });
}

const play = (page: Page, midis: number[]) =>
  page.evaluate((m) => (window as unknown as { __playChord: (x: number[]) => void }).__playChord(m), midis);

test('akor dinleyici: duyulan akoru gösterir ve seçili akorun doğru basılıp basılmadığını denetler', async ({ page }, info) => {
  await useChordInput(page);
  await page.goto('./#/chords');
  await expect(page.getByTestId('chord-listener')).toBeVisible();
  await expectHealthyLayout(page);

  await page.getByTestId('listen-toggle').click();
  await expect(page.getByTestId('heard-chord')).toHaveText('–');

  await play(page, AM);
  await expect(page.getByTestId('heard-chord')).toHaveText('Am');

  // Hedef akor seç: diyagrama dokun.
  await page.getByRole('button', { name: 'Am akorunu çal' }).click();
  await expect(page.getByTestId('listen-check')).toHaveText('Am: doğru basıldı');
  await expectHealthyLayout(page);
  await shot(page, info, 'chord-listener-match');

  // Yanlış akor.
  await play(page, C);
  await expect(page.getByTestId('heard-chord')).toHaveText('C');
  await expect(page.getByTestId('listen-check')).toHaveText('Am bekleniyor, ama C duyuldu');
  await shot(page, info, 'chord-listener-wrong');

  await play(page, G);
  await expect(page.getByTestId('heard-chord')).toHaveText('G');

  // Sessizlik.
  await play(page, []);
  await expect(page.getByTestId('heard-chord')).toHaveText('–');
  await expect(page.getByTestId('listen-check')).toHaveText('Am bekleniyor — şimdi çal');

  await page.getByTestId('listen-toggle').click();
  await expect(page.getByTestId('heard-chord')).toHaveCount(0);
});

test('geçiş egzersizi: akor değişimleri mikrofonla otomatik sayılır', async ({ page }, info) => {
  await useChordInput(page);
  await page.goto('./#/chords/practice');
  await page.getByTestId('quick-pairs').getByRole('button', { name: 'Am ↔ C' }).click();
  await page.getByTestId('tx-duration').getByRole('radio', { name: '30 sn' }).click();
  await page.getByTestId('tx-auto').click();
  await expect(page.getByTestId('tx-auto')).toHaveAttribute('aria-checked', 'true');
  await expectHealthyLayout(page);

  await page.clock.install();
  await page.getByTestId('tx-start').click();
  await expect(page.getByTestId('tx-run')).toHaveAttribute('data-phase', 'countin');
  // Sayım sırasında çalınan akor sayılmaz.
  await play(page, C);
  await page.waitForTimeout(400);
  await play(page, []);
  await page.waitForTimeout(300);
  await page.clock.fastForward(3200);
  await expect(page.getByTestId('tx-run')).toHaveAttribute('data-phase', 'running');
  await expect(page.getByTestId('tx-plus')).toContainText('0');

  // Am ile başla, sonra 6 kez değiştir: Am → C → Am → C → Am → C → Am.
  await play(page, AM);
  await expect(page.getByTestId('tx-heard')).toHaveText('Duyulan: Am');
  await expect(page.getByTestId('pair-chord-0')).toHaveClass(/heard-now/);
  for (let i = 0; i < 6; i++) {
    await play(page, i % 2 === 0 ? C : AM);
    await expect(page.getByTestId('tx-heard')).toHaveText(`Duyulan: ${i % 2 === 0 ? 'C' : 'Am'}`);
    await expect(page.getByTestId('tx-plus')).toContainText(String(i + 1));
  }
  // İlgisiz bir akor ve sessizlik sayıyı değiştirmez.
  await play(page, G);
  await page.waitForTimeout(500);
  await play(page, []);
  await page.waitForTimeout(300);
  await expect(page.getByTestId('tx-plus')).toContainText('6');
  await expectHealthyLayout(page);
  await shot(page, info, 'transition-auto');

  await page.clock.fastForward(31_000);
  await expect(page.getByTestId('tx-done')).toBeVisible();
  await expect(page.getByTestId('tx-count').locator('output')).toHaveText('6');
  await page.getByTestId('tx-save').click();
  // 30 sn'de 6 geçiş = dakikada 12.
  await expect(page.getByTestId('tx-saved')).toHaveText('Kaydedildi: dakikada 12 geçiş.');
  await expect(page.getByTestId('tx-best')).toHaveText('12');
});

test('akor dinleyici: mikrofon izni yoksa hata gösterir', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
  });
  await page.goto('./#/chords');
  await page.getByTestId('listen-toggle').click();
  await expect(page.getByTestId('chord-listener').getByTestId('input-error')).toContainText('Mikrofon izni verilmedi');
  await expect(page.getByTestId('heard-chord')).toHaveCount(0);
});
