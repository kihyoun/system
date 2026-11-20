import { expect, test } from '@playwright/test';

for (const width of [320, 390, 1024, 1440]) {
  test(`language switch and centered navigation fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const header = page.getByRole('banner');
    await expect(header.getByRole('button', { name: 'English', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const german of [false, true]) {
      if (german) await header.getByRole('button', { name: 'German', exact: true }).click();
      const navigation = header.getByRole('navigation', { name: german ? 'Hauptnavigation' : 'Main navigation' });
      for (const name of [german ? 'Übersicht' : 'Overview', 'Wizard', 'Docs']) {
        await navigation.getByRole('tab', { name, exact: true }).click();
        // Wait for the persistent drawer's width transition before measuring the toolbar.
        await expect.poll(async () => navigation.evaluate(element => {
          const nav = element.getBoundingClientRect();
          const bar = element.closest('header')!.getBoundingClientRect();
          return Math.abs((nav.left + nav.right) / 2 - (bar.left + bar.right) / 2);
        })).toBeLessThan(2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const layout = await header.evaluate(element => {
          const nav = element.querySelector('nav')!.getBoundingClientRect();
          const title = element.querySelector('h6')!.getBoundingClientRect();
          const language = element.querySelector('[role="group"]')!.getBoundingClientRect();
          const separate = (a: DOMRect, b: DOMRect) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
          return separate(nav, title) && separate(nav, language) && separate(title, language);
        });
        expect(layout).toBe(true);
      }
    }
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page.reload();
    await expect(header.getByRole('button', { name: 'Deutsch', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await header.getByRole('button', { name: 'Englisch', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
}

test('German legal labels leave published operator information unchanged', async ({ page }) => {
  const published = {
    operatorName: 'An unchanged operator', operatorAddress: 'Any street\nSome city',
    contactEmail: 'operator@example.com', privacyNoticeUrl: '', accessLogRetention: 'Seven days verbatim',
    additionalPrivacyText: 'Custom operator privacy text stays exactly as published.'
  };
  await page.route('**/privacy-instance.json', route => route.fulfill({ json: published }));
  await page.goto('/privacy');
  await page.getByRole('banner').getByRole('button', { name: 'German', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Datenschutz', exact: true })).toBeVisible();
  for (const value of [published.operatorName, published.contactEmail, published.additionalPrivacyText]) {
    await expect(page.getByText(value, { exact: true })).toBeVisible();
  }
  await expect(page.getByText(`Veröffentlichte Aufbewahrungsdauer der Zugriffsprotokolle: ${published.accessLogRetention}`, { exact: true })).toBeVisible();
});
