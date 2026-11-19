import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Функции расчёта объявлены в странице как глобальные: ratio, parse, hex, suggest.
const calc = <T,>(page: Page, fn: () => T) => page.evaluate(fn);

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#ratio')).toHaveText('4.54 : 1');
});

test('расчёт совпадает с эталонными значениями WCAG', async ({ page }) => {
  const r = await calc(page, () => ({
    bw: ratio([0, 0, 0], [255, 255, 255]),
    g767676: ratio(parse('#767676')!, parse('#fff')!),
    g777: ratio(parse('#777')!, parse('#ffffff')!),
    same: ratio([10, 20, 30], [10, 20, 30]),
  }));
  expect(r.bw).toBeCloseTo(21, 5);
  expect(r.g767676).toBeGreaterThanOrEqual(4.5); // #767676 — самый светлый серый, проходящий AA на белом
  expect(r.g777).toBeLessThan(4.5); // #777777 уже не проходит: 4.48
  expect(r.same).toBeCloseTo(1, 5);
});

test('разбор цветов: короткая запись, регистр, мусор', async ({ page }) => {
  const r = await calc(page, () => ({
    short: parse('#abc'),
    upper: parse('#AABBCC'),
    noHash: parse('abc123'),
    bad: [parse('#abcd'), parse('xyz'), parse(''), parse('#12345g')],
  }));
  expect(r.short).toEqual([170, 187, 204]);
  expect(r.upper).toEqual([170, 187, 204]);
  expect(r.noHash).toEqual([0xab, 0xc1, 0x23]);
  expect(r.bad).toEqual([null, null, null, null]);
});

test('подбор цвета всегда проходит AA и не меняет цвет без нужды', async ({ page }) => {
  const res = await calc(page, () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 256;
    let tested = 0;
    const bad: string[] = [];
    for (let i = 0; i < 400; i++) {
      const fg = [rnd(), rnd(), rnd()].map(Math.floor);
      const bg = [rnd(), rnd(), rnd()].map(Math.floor);
      const s = suggest(fg, bg, 4.5);
      if (ratio(fg, bg) >= 4.5) {
        if (s !== null) bad.push(`лишнее предложение для ${fg}/${bg}`);
        continue;
      }
      if (s === null) continue; // для фона средней яркости 4.5 недостижимо ни тёмным, ни светлым
      tested++;
      if (ratio(s, bg) < 4.5) bad.push(`предложение ${s} не проходит на ${bg}`);
    }
    return { tested, bad };
  });
  expect(res.bad).toEqual([]);
  expect(res.tested).toBeGreaterThan(100);
});

test('значения по умолчанию: AA проходит, AAA для обычного текста нет', async ({ page }) => {
  const badges = page.locator('#badges .badge');
  await expect(badges).toHaveCount(4);
  await expect(badges.nth(0)).toHaveClass(/pass/); // AA текст ≥ 4.5
  await expect(badges.nth(1)).toHaveClass(/pass/); // AA крупный ≥ 3
  await expect(badges.nth(2)).toHaveClass(/fail/); // AAA текст ≥ 7
  await expect(badges.nth(3)).toHaveClass(/pass/); // AAA крупный ≥ 4.5
  await expect(page.locator('#sugCard')).toBeHidden();
});

test('непроходящий цвет: показан подбор, «Применить» исправляет контраст', async ({ page }) => {
  await page.locator('#fgT').fill('#777777');
  await expect(page.locator('#ratio')).toHaveText('4.48 : 1');
  await expect(page.locator('#badges .badge').nth(0)).toHaveClass(/fail/);
  await expect(page.locator('#sugCard')).toBeVisible();
  const suggestion = (await page.locator('#sugHex').innerText()).trim();
  expect(suggestion).toMatch(/^#[0-9a-f]{6}$/);
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.locator('#fgT')).toHaveValue(suggestion);
  await expect(page.locator('#badges .badge').nth(0)).toHaveClass(/pass/);
  await expect(page.locator('#sugCard')).toBeHidden();
});

test('«Поменять местами» не меняет контраст', async ({ page }) => {
  await page.getByRole('button', { name: /Поменять местами/ }).click();
  await expect(page.locator('#fgT')).toHaveValue('#ffffff');
  await expect(page.locator('#bgT')).toHaveValue('#767676');
  await expect(page.locator('#ratio')).toHaveText('4.54 : 1');
});

test('неверный ввод подсвечивается и не ломает результат', async ({ page }) => {
  await page.locator('#fgT').fill('#12');
  await expect(page.locator('#fgT')).toHaveClass(/err/);
  await expect(page.locator('#ratio')).toHaveText('4.54 : 1'); // остаётся последнее верное значение
  await page.locator('#fgT').fill('#000');
  await expect(page.locator('#fgT')).not.toHaveClass(/err/);
  await expect(page.locator('#ratio')).toHaveText('21.00 : 1'); // #000 (короткая запись) на #ffffff
});

test('цвета сохраняются в ссылке и восстанавливаются из неё', async ({ page }) => {
  await page.locator('#fgT').fill('#112233');
  await page.locator('#bgT').fill('#ffeedd');
  await expect.poll(() => page.url()).toContain('#112233-ffeedd');
  await page.goto('./#000000-ffffff');
  await expect(page.locator('#ratio')).toHaveText('21.00 : 1');
  await expect(page.locator('#fgT')).toHaveValue('#000000');
});

test('выбор цвета палитрой обновляет поле и расчёт', async ({ page }) => {
  await page.locator('#fgC').fill('#ff0000');
  await expect(page.locator('#fgT')).toHaveValue('#ff0000');
  await expect(page.locator('#ratio')).toHaveText('4.00 : 1'); // красный #ff0000 на белом
});

test('нет горизонтальной прокрутки', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`доступность (axe), ${scheme === 'light' ? 'светлая' : 'тёмная'} тема`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const check = async (label: string) => {
      // #preview намеренно рисует проверяемую пару цветов, в том числе непроходящую, поэтому его контраст не проверяется
      const res = await new AxeBuilder({ page }).exclude('#preview').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.html}`), label).toEqual([]);
    };
    await check('по умолчанию');
    await page.locator('#fgT').fill('#777777');
    await expect(page.locator('#sugCard')).toBeVisible();
    await check('с подбором цвета');
    await page.locator('#fgT').fill('#12');
    await check('с ошибкой ввода');
  });
}
