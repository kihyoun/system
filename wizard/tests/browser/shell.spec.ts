import { expect, test } from '@playwright/test';

for (const width of [320, 390, 1024, 1440]) {
  test(`toolbar navigation, drawer and footer work at ${width}px in both themes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const header = page.getByRole('banner');
    const tabs = header.getByRole('tablist', { name: 'Main navigation' });
    await expect(page.getByRole('tablist', { name: 'Main navigation' })).toHaveCount(1);
    for (const dark of [false, true]) {
      if (dark) await header.getByRole('switch').check();
      for (const name of ['Overview', 'Wizard', 'Docs']) {
        await tabs.getByRole('tab', { name, exact: true }).click();
        await expect(tabs.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
        await expect(header.getByText(name === 'Wizard' ? 'System Bootstrapper Control Panel' : 'System Bootstrapper', { exact: true })).toBeVisible();
        const footer = page.getByRole('contentinfo');
        const colors = await header.evaluate(element => ({
          background: getComputedStyle(element).backgroundColor,
          image: getComputedStyle(element).backgroundImage
        }));
        await expect(footer).toHaveCSS('background-color', colors.background);
        await expect(footer).toHaveCSS('background-image', colors.image);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        const navigationLayout = await tabs.evaluate(element => {
          const rect = element.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth + 1;
        });
        expect(navigationLayout).toBe(true);
        if (name === 'Wizard') {
          const closeDrawer = page.getByRole('button', { name: 'Close server drawer', exact: true });
          if (await closeDrawer.isVisible()) await closeDrawer.click();
          await header.getByRole('button', { name: 'open drawer', exact: true }).click();
          await expect(closeDrawer).toBeVisible();
          if (width < 900) {
            await page.keyboard.press('Escape');
            await expect(closeDrawer).toBeHidden();
            await expect(header.getByRole('button', { name: 'open drawer', exact: true })).toBeFocused();
          } else {
            await closeDrawer.click();
          }
        }
      }
    }
  });
}

test('Docs is reachable offline, supports history and preserves the Wizard form', async ({ page }) => {
  await page.goto('/configuration');
  await page.getByRole('tab', { name: 'Website', exact: true }).click();
  const operator = page.getByLabel('Operator name', { exact: true });
  await operator.fill('Unsaved operator');
  const navigation = page.getByRole('tablist', { name: 'Main navigation' });
  await page.context().setOffline(true);
  await navigation.getByRole('tab', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/docs#docs\/getting-started$/);
  await expect(page.getByRole('heading', { name: '0. Getting Started', exact: true })).toBeVisible();
  await page.goBack();
  await expect(navigation.getByRole('tab', { name: 'Wizard', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(operator).toHaveValue('Unsaved operator');
  await page.goForward();
  await expect(navigation.getByRole('tab', { name: 'Docs', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('handbook links open integrated Docs and direct routes remain distinct', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Read the handbook', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Docs', exact: true })).toHaveAttribute('aria-selected', 'true');
  for (const route of ['/docs#docs/installation', '/#docs/recovery']) {
    await page.goto(route);
    await expect(page.getByRole('tab', { name: 'Docs', exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  for (const route of ['/privacy', '/imprint']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: route.slice(1, 2).toUpperCase() + route.slice(2), exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Docs', exact: true })).toHaveAttribute('aria-selected', 'false');
  }
});
