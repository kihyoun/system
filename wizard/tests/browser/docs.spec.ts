import { expect, test } from '@playwright/test';

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
  expect(await screenshot.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
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
  }
});
