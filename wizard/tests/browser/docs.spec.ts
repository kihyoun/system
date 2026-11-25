import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

async function expectNoHorizontalOverflow(page: Page, context: string) {
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    elements: Array.from(document.querySelectorAll('h1, h2, h3, h4, p, li, a, label, select, button')).map(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return { tag: element.tagName, text: element.textContent?.slice(0, 80), right: Math.max(element.getBoundingClientRect().right, range.getBoundingClientRect().right) };
    }).filter(element => element.right > innerWidth + 1).slice(0, 10)
  }));
  expect(overflow.scrollWidth, `${context}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.width + 1);
}

async function expectSeparatedVersionLabel(control: Locator) {
  const layout = await control.evaluate(element => {
    const select = element as HTMLSelectElement;
    const label = select.labels?.[0];
    if (!label) throw new Error('Version selection has no associated visible label.');
    const labelBox = label.getBoundingClientRect();
    const selectBox = select.getBoundingClientRect();
    const style = getComputedStyle(select);
    return {
      labelWidth: labelBox.width,
      labelBottom: labelBox.bottom,
      textTop: selectBox.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
      textBottom: selectBox.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom)
    };
  });
  expect(layout.labelWidth).toBeGreaterThan(0);
  expect(layout.textBottom).toBeGreaterThan(layout.textTop);
  expect(layout.labelBottom + 2).toBeLessThanOrEqual(layout.textTop);
}

async function selectVersionWithKeyboard(control: Locator, keys: string[]) {
  await control.focus();
  for (const key of keys) await control.press(key);
  // Commit both immediate-selection and popup-style native select behavior.
  await control.press('Enter');
  await control.press('Tab');
}

test('search opens matching bundled content and chapter history works', async ({ page }) => {
  await page.goto('/docs#docs/getting-started');
  await page.getByRole('textbox', { name: 'Search all docs' }).fill('checksummed completion manifest');
  const results = page.getByRole('region', { name: 'Documentation search results' });
  await expect(results).toContainText('checksummed completion manifest');
  await results.getByRole('link', { name: '3. Configuration · main actions' }).click();
  await expect(page).toHaveURL(/#docs\/configuration\//);
  await expect(page.getByRole('heading', { level: 1, name: '3. Configuration · main actions' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('Harvest');
  await page.getByRole('link', { name: 'recovery contract', exact: true }).click();
  await expect(page).toHaveURL(/#docs\/seed-recovery$/);
  await expect(page.getByRole('heading', { level: 1, name: '7.2 Configuration and Seed recovery' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#docs\/configuration\//);
  await page.goForward();
  await expect(page).toHaveURL(/#docs\/seed-recovery$/);
});

test('command copy confirms success and excludes prompts and example output', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs#docs/getting-started');
  await page.getByRole('button', { name: 'Copy bash example' }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('uname -m\ngit --version');
  await page.goto('/docs#docs/installation/04-find-the-signature-server-address-and-actual-credentials');
  const output = page.locator('pre').filter({ hasText: 'server listening on' });
  await expect(output).toBeVisible();
  await expect(output.locator('..').getByRole('button', { name: /Copy/ })).toHaveCount(0);
});

test('clipboard rejection explains manual copying and permits another attempt', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new DOMException('Clipboard denied', 'NotAllowedError')) }
    });
  });
  await page.goto('/docs#docs/getting-started');
  await page.getByRole('button', { name: 'Copy bash example' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Could not copy' })).toContainText('Select the example and copy it manually');
  await expect(page.getByRole('button', { name: 'Copy bash example' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toHaveCount(0);
});

test('installation screenshots, code highlighting and detailed links work offline', async ({ page, context }) => {
  await page.goto('/docs#docs/installation');
  await context.setOffline(true);
  const screenshot = page.getByRole('img', { name: 'Overview with the platform introduction and Quick Install' });
  await screenshot.scrollIntoViewIfNeeded();
  await expect(screenshot).toBeVisible();
  await expect.poll(() => screenshot.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  expect(await page.locator('pre code span[style]').count()).toBeGreaterThan(0);
  await page.getByRole('link', { name: 'persistence guide', exact: true }).click();
  await expect(page).toHaveURL(/#docs\/storage$/);
  await expect(page.getByRole('heading', { level: 1, name: '7.1 Working data and independent backups' })).toBeVisible();
});

test('long chapters fit mobile and desktop with accessible chapter selection', async ({ page }) => {
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/docs#docs/public-installation');
    await expect(page.getByRole('heading', { level: 1, name: '1.2 Public server · domain and HTTPS' })).toBeVisible();
    const searchBounds = await page.getByRole('textbox', { name: 'Search all docs' }).boundingBox();
    expect(searchBounds!.y).toBeGreaterThan(0);
    expect(searchBounds!.y + searchBounds!.height).toBeLessThan(900);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 320) {
      await page.getByRole('button', { name: 'Open docs drawer', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'Documentation chapters' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('navigation', { name: 'Documentation chapters' })).toBeHidden();
      await expect(page.getByRole('button', { name: 'Open docs drawer', exact: true })).toBeFocused();
      await page.getByRole('button', { name: 'Open docs drawer', exact: true }).click();
      await page.getByRole('navigation', { name: 'Documentation chapters' }).getByRole('link', { name: '4. GitLab runners', exact: true }).click();
      await expect(page.getByRole('heading', { name: '4. GitLab runners', exact: true })).toBeFocused();
    }
    await page.goto('/docs#docs/releases');
    for (const [locale, title, sourceLabel, targetLabel, unknown, supported] of [
      ['en', 'Release migration guide', 'Installed version', 'Target version', 'Unknown / other version', 'Supported transition'],
      ['de', 'Migrationsleitfaden für Releases', 'Installierte Version', 'Zielversion', 'Unbekannte / andere Version', 'Unterstützter Übergang'],
      ['ko', '릴리스 마이그레이션 가이드', '설치된 버전', '대상 버전', '알 수 없는 버전 / 다른 버전', '지원되는 전환입니다.']
    ]) {
      await page.getByRole('banner').locator(`button[lang="${locale}"]`).click();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      const guide = page.getByRole('region', { name: title, exact: true });
      const source = guide.getByRole('combobox', { name: sourceLabel, exact: true });
      const target = guide.getByRole('combobox', { name: targetLabel, exact: true });
      for (const control of [source, target]) {
        await expect(control).toBeVisible();
        expect(await control.evaluate(element => element.tagName)).toBe('SELECT');
        await selectVersionWithKeyboard(control, ['Home']);
        await expect(control).toHaveValue('');
        await expect(control.locator('option:checked')).toHaveText(unknown);
        await expectSeparatedVersionLabel(control);
      }
      await expectNoHorizontalOverflow(page, `${locale}/${width}: unknown versions`);
      // Native option order: Unknown, 1.0.0, 1.1.0, 1.1.1, 1.1.2, 1.1.3.
      await selectVersionWithKeyboard(source, ['Home', ...Array(5).fill('ArrowDown')]);
      await expect(source).toHaveValue('1.1.3');
      await selectVersionWithKeyboard(target, ['End']);
      await expect(target).toHaveValue('2.0.1');
      await expect(guide.getByRole('status').first()).toContainText(supported);
      await expect(guide.getByRole('heading', { name: '1.1.3 → 1.2.0', exact: true })).toBeVisible();
      await expect(guide.getByRole('heading', { name: '1.2.0 → 2.0.1', exact: true })).toBeVisible();
      for (const control of [source, target]) await expectSeparatedVersionLabel(control);
      await expectNoHorizontalOverflow(page, `${locale}/${width}: supported migration`);
    }
    await page.getByRole('banner').locator('button[lang="en"]').click();
  }
});
