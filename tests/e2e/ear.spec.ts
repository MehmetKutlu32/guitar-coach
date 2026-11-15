import { expect, test, type Page } from '@playwright/test';
import { expectHealthyLayout, shot } from './helpers';

const rms = (page: Page) => page.evaluate(() => window.__gitar!.outputRms());

/**
 * Bir turu oynar: `wrongAt` sıralarındaki sorular bilerek yanlış, diğerleri doğru yanıtlanır.
 * @returns Sorulan türler.
 */
async function playRound(page: Page, allowed: string[], wrongAt: number[], onQuestion?: (i: number) => Promise<void>): Promise<string[]> {
  const asked: string[] = [];
  for (let i = 0; i < 10; i++) {
    const progress = page.getByTestId('ear-progress');
    await expect(progress).toContainText(`Soru ${i + 1} / 10`);
    await expect(progress).toHaveAttribute('data-feedback', '');
    const item = (await progress.getAttribute('data-item'))!;
    const root = Number(await progress.getAttribute('data-root'));
    expect(allowed).toContain(item);
    expect(root).toBeGreaterThanOrEqual(40);
    expect(root).toBeLessThanOrEqual(76);
    asked.push(item);
    if (onQuestion) await onQuestion(i);
    if (wrongAt.includes(i)) {
      const other = allowed.find((x) => x !== item)!;
      await page.getByTestId(`ear-answer-${other}`).click();
      await expect(page.getByTestId('ear-feedback')).toContainText('Yanlış — doğrusu');
      // Doğru yanıt yeşil, seçilen kırmızı işaretlenir; iki ses karşılaştırılabilir.
      await expect(page.getByTestId(`ear-answer-${item}`)).toHaveClass(/good/);
      await expect(page.getByTestId(`ear-answer-${other}`)).toHaveClass(/bad/);
      await expect(page.getByTestId('ear-hear-chosen')).toBeVisible();
      await page.getByTestId('ear-next').click();
    } else {
      await page.getByTestId(`ear-answer-${item}`).click();
      await expect(page.getByTestId('ear-feedback')).toHaveText('Doğru!');
    }
  }
  await expect(page.getByTestId('ear-summary')).toBeVisible();
  return asked;
}

test('aralık tanıma: seviye 1 turu, skor ve seviye açma', async ({ page }, info) => {
  await page.goto('./#/ear');
  await expect(page.getByTestId('page-title')).toHaveText('Kulak eğitimi');
  // Başta yalnızca 1. seviye açık.
  await expect(page.getByTestId('ear-level-1')).toHaveAttribute('aria-checked', 'true');
  for (const n of [2, 3, 4, 5, 6]) await expect(page.getByTestId(`ear-level-${n}`)).toBeDisabled();
  await expect(page.getByTestId('ear-items').getByRole('button')).toHaveText(['Büyük üçlü (B3)', 'Tam beşli (T5)', 'Oktav (T8)']);
  await expect(page.getByTestId('ear-directions')).toHaveText('Çalınış: çıkıcı.');
  await expect(page.getByTestId('ear-unlock-hint')).toHaveText('Seviye 2 kilidi: seviye 1 turunda en az 8/10 doğru.');
  await expect(page.getByTestId('ear-empty')).toBeVisible();
  await expectHealthyLayout(page);
  await shot(page, info, 'ear-setup', true);

  // Türe dokununca örnek çalınır.
  await page.getByTestId('ear-example-7').click();
  await expect.poll(() => rms(page)).toBeGreaterThan(0.01);

  await page.getByTestId('ear-start').click();
  await expect(page.getByTestId('ear-prompt')).toContainText('Hangi aralık?');
  await expect(page.getByTestId('ear-answers').getByRole('button')).toHaveCount(3);
  // Soru kendiliğinden çalınır.
  await expect.poll(() => rms(page)).toBeGreaterThan(0.01);
  await expectHealthyLayout(page);
  await shot(page, info, 'ear-question');

  const asked = await playRound(page, ['4', '7', '12'], [2, 6], async (i) => {
    if (i === 1) {
      // Tekrar dinle: ses yeniden çıkar.
      await expect.poll(() => rms(page), { timeout: 8000 }).toBeLessThan(0.003);
      await page.getByTestId('ear-replay').click();
      await expect.poll(() => rms(page)).toBeGreaterThan(0.01);
    }
  });
  // Türler dengeli: üç aralığın her biri en az 3 kez soruldu.
  for (const item of ['4', '7', '12']) expect(asked.filter((x) => x === item).length).toBeGreaterThanOrEqual(3);

  await expect(page.getByTestId('ear-summary')).toContainText('10 sorudan 8 doğru');
  await expect(page.getByTestId('ear-summary')).toContainText('Seviye 2 açıldı!');
  await expect(page.getByTestId('ear-summary')).toContainText('Karıştırdıkların:');
  await expect(page.getByTestId('ear-best')).toHaveText('80');
  await expect(page.getByTestId('ear-rounds')).toHaveText('1');
  // Türlere göre doğruluk: yanlış yapılan türler %100'ün altında.
  const percents = await page
    .getByTestId('ear-accuracy')
    .locator('.acc-row')
    .evaluateAll((rows) => rows.map((r) => Number(r.getAttribute('data-percent'))));
  expect(percents).toHaveLength(3);
  expect(Math.min(...percents)).toBeLessThan(100);
  expect([...percents].sort((a, b) => a - b)).toEqual(percents);
  await expectHealthyLayout(page);
  await shot(page, info, 'ear-summary', true);

  // Yeni seviyeye geç: daha çok aralık.
  await expect(page.getByTestId('ear-level-2')).toBeEnabled();
  await expect(page.getByTestId('ear-level-3')).toBeDisabled();
  await page.getByTestId('ear-go-next').click();
  await expect(page.getByTestId('ear-level-2')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('ear-items').getByRole('button')).toHaveCount(5);
  await expect(page.getByTestId('ear-empty')).toBeVisible();

  // İlerleme ve seçim kalıcı.
  await page.evaluate(() => window.__gitar!.flush());
  await page.reload();
  await expect(page.getByTestId('ear-level-2')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('ear-level-3')).toBeDisabled();
  await page.getByTestId('ear-level-1').click();
  await expect(page.getByTestId('ear-best')).toHaveText('80');
});

test('akor türü tanıma: geçilemeyen tur seviye açmaz; yarıda bırakılan tur kaydedilmez', async ({ page }, info) => {
  await page.goto('./#/ear');
  await page.getByTestId('ear-kind').getByRole('radio', { name: 'Akorlar' }).click();
  await expect(page.getByTestId('ear-items').getByRole('button')).toHaveText(['Majör (maj)', 'Minör (m)']);
  await expect(page.getByTestId('ear-directions')).toHaveCount(0);

  // Yarıda bırakılan tur.
  await page.getByTestId('ear-start').click();
  await expect(page.getByTestId('ear-prompt')).toContainText('Hangi akor türü?');
  await expect.poll(() => rms(page)).toBeGreaterThan(0.01);
  await expect(page.getByTestId('ear-answers').getByRole('button')).toHaveCount(2);
  // Akorun notaları tek tek de dinlenebilir.
  await expect(page.getByTestId('ear-apart')).toBeVisible();
  await expectHealthyLayout(page);
  await page.getByTestId('ear-quit').click();
  await expect(page.getByTestId('ear-empty')).toBeVisible();
  await expect(page.getByTestId('ear-summary')).toHaveCount(0);

  // 7/10: seviye açılmaz.
  await page.getByTestId('ear-start').click();
  await playRound(page, ['maj', 'min'], [0, 4, 9], async (i) => {
    if (i === 0) await shot(page, info, 'ear-chord-question');
  });
  await expect(page.getByTestId('ear-summary')).toContainText('10 sorudan 7 doğru');
  await expect(page.getByTestId('ear-summary')).toContainText('Sonraki seviye için en az 8 doğru gerekir.');
  await expect(page.getByTestId('ear-go-next')).toHaveCount(0);
  await expect(page.getByTestId('ear-level-2')).toBeDisabled();
  await expect(page.getByTestId('ear-best')).toHaveText('70');

  // İkinci tur 10/10: seviye 2 açılır, grafik görünür.
  await page.getByTestId('ear-start').click();
  await playRound(page, ['maj', 'min'], []);
  await expect(page.getByTestId('ear-summary')).toContainText('10 sorudan 10 doğru');
  await expect(page.getByTestId('ear-summary')).toContainText('Seviye 2 açıldı!');
  await expect(page.getByTestId('ear-best')).toHaveText('100');
  await expect(page.getByTestId('ear-last')).toHaveText('100');
  await expect(page.getByTestId('ear-avg')).toHaveText('85');
  await expect(page.getByTestId('ear-rounds')).toHaveText('2');
  await expect(page.getByTestId('ear-chart')).toBeVisible();
  await expect(page.getByTestId('ear-level-2')).toBeEnabled();
  await expectHealthyLayout(page);
  await shot(page, info, 'ear-chord-summary', true);

  // Aralık ilerlemesi akorlardan bağımsızdır.
  await page.getByTestId('ear-kind').getByRole('radio', { name: 'Aralıklar' }).click();
  await expect(page.getByTestId('ear-level-2')).toBeDisabled();
  await expect(page.getByTestId('ear-empty')).toBeVisible();
});

test('son seviye: 12 aralık, inici ve birlikte çalınış; ilerleme kayıtlı sonuçlardan türetilir', async ({ page }, info) => {
  await page.goto('./#/ear');
  await expect(page.getByTestId('ear-level-2')).toBeDisabled();
  // 1–5. seviyeleri geçmiş bir kullanıcının verisi (ör. içe aktarılmış yedek).
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('gitar-app');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('results', 'readwrite');
          for (let level = 1; level <= 5; level++) {
            tx.objectStore('results').put({
              id: `seed-${level}`,
              type: 'ear',
              date: Date.now() - (6 - level) * 86_400_000,
              kind: 'interval',
              level,
              correct: 9,
              total: 10,
              seconds: 40,
              items: { '7': [5, 5], '6': [5, 4] },
            });
          }
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  await page.reload();
  await expect(page.getByTestId('ear-level-6')).toBeEnabled();
  await page.getByTestId('ear-level-6').click();
  await expect(page.getByTestId('ear-items').getByRole('button')).toHaveCount(12);
  await expect(page.getByTestId('ear-directions')).toHaveText('Çalınış: çıkıcı, inici, birlikte.');
  await expect(page.getByTestId('ear-unlock-hint')).toHaveText('Tüm seviyeler açık.');
  await expectHealthyLayout(page);

  await page.getByTestId('ear-start').click();
  await expect(page.getByTestId('ear-answers').getByRole('button')).toHaveCount(12);
  const progress = page.getByTestId('ear-progress');
  const item = (await progress.getAttribute('data-item'))!;
  const direction = (await progress.getAttribute('data-direction'))!;
  expect(['up', 'down', 'together']).toContain(direction);
  await expect(page.getByTestId('ear-prompt')).toContainText({ up: 'çıkıcı', down: 'inici', together: 'birlikte' }[direction]!);
  await expectHealthyLayout(page);
  await shot(page, info, 'ear-level6');

  // Yanlış yanıt: "Sonraki" kaydırmadan görünür; seçilen aralık dinlenebilir.
  const other = item === '1' ? '2' : '1';
  await page.getByTestId(`ear-answer-${other}`).click();
  await expect(page.getByTestId('ear-next')).toBeInViewport({ ratio: 1 });
  await expect.poll(() => rms(page), { timeout: 8000 }).toBeLessThan(0.003);
  await page.getByTestId('ear-hear-chosen').click();
  await expect.poll(() => rms(page)).toBeGreaterThan(0.01);
  await expectHealthyLayout(page);
  await shot(page, info, 'ear-wrong');
  await page.getByTestId('ear-next').click();
  await expect(progress).toContainText('Soru 2 / 10');
});

test('kulak eğitimi İngilizce arayüzde ve ana sayfada', async ({ page }) => {
  await page.goto('./#/');
  await expect(page.getByTestId('tool-ear')).toContainText('Kulak eğitimi');
  await page.getByTestId('tool-ear').click();
  await expect(page.getByTestId('page-title')).toHaveText('Kulak eğitimi');
  await page.goto('./#/settings');
  await page.getByTestId('lang').getByRole('radio', { name: 'English' }).click();
  await page.evaluate(() => window.__gitar!.flush());
  await page.goto('./#/ear');
  await expect(page.getByTestId('page-title')).toHaveText('Ear training');
  await expect(page.getByTestId('ear-items').getByRole('button')).toHaveText(['Major 3rd (M3)', 'Perfect 5th (P5)', 'Octave (P8)']);
  await page.getByTestId('ear-start').click();
  await expect(page.getByTestId('ear-prompt')).toContainText('Which interval?');
  await expect(page.getByTestId('ear-answer-7')).toContainText('P5');
});
