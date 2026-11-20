import { expect, test } from '@playwright/test';

test('Overview works before login and keyboard navigation opens the existing Wizard', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'fetch' || request.resourceType() === 'xhr' ||
        /fonts\.googleapis|fonts\.gstatic/.test(request.url())) unexpected.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByText('System Bootstrapper', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'You build it. You own it.', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'How it works', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Privacy', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Read the handbook', exact: true }))
    .toHaveAttribute('href', '#docs/getting-started');
  const navigation = page.getByRole('tablist', { name: 'Main navigation' });
  await navigation.getByRole('tab', { name: 'Overview', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(navigation.getByRole('tab', { name: 'Wizard', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toBeVisible();
  expect(unexpected).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`Overview and its blue footer remain usable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route('**/privacy-instance.json', route => route.fulfill({ json: {
      operatorName: 'Max Mustermann', operatorAddress: 'Musterstraße 1\n12345 Musterstadt\nDeutschland',
      contactEmail: 'kontakt@example.com', privacyNoticeUrl: '', accessLogRetention: '', additionalPrivacyText: ''
    } }));
    await page.goto('/');
    const title = page.getByRole('heading', { level: 1, name: 'You build it. You own it.', exact: true });
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS('font-size', viewport.width < 900 ? '38px' : '60px');
    await expect(page.getByText('System Bootstrapper is an open-source platform that brings your development tools together on your own server.', {exact:true})).toBeVisible();
    await expect(page.getByText('Build your web projects. Bring your development tools together.', {exact:true})).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 2, name: 'How it works', exact: true })).toBeVisible();
    const titleLayout = await title.evaluate(heading => {
      const box = heading.getBoundingClientRect();
      return { withinViewport: box.left >= 0 && box.right <= innerWidth,
        textFits: heading.scrollWidth <= heading.clientWidth + 1 };
    });
    expect(titleLayout.withinViewport).toBe(true);
    expect(titleLayout.textFits).toBe(true);
    await expect(page.getByRole('button', { name: 'Install System Bootstrapper', exact: true }))
      .toHaveCSS('background-color', 'rgb(245, 0, 87)');
    await page.screenshot({ path: test.info().outputPath(`overview-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
    for (const destination of ['Overview', 'Wizard', 'Docs', 'Privacy', 'Imprint']) {
      if (destination !== 'Overview') {
        await page.getByRole('navigation', { name: 'Footer navigation' })
          .getByRole('button', { name: destination, exact: true }).click();
      }
      if (destination === 'Wizard') {
        await page.getByRole('tab', { name: 'Website', exact: true }).click();
        await expect(page.getByLabel('Operator name', { exact: true })).toHaveValue('Max Mustermann');
        await expect(page.getByLabel('Operator name', { exact: true })).toHaveAttribute('placeholder', 'Max Mustermann');
        await expect(page.getByLabel('Postal address', { exact: true })).toHaveValue('Musterstraße 1\n12345 Musterstadt\nDeutschland');
        await expect(page.getByLabel('Contact email', { exact: true })).toHaveValue('kontakt@example.com');
        await expect(page.getByLabel('Access-log retention', { exact: true })).toHaveValue('');
        await page.screenshot({ path: test.info().outputPath(`website-settings-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
      }
      const footer = page.getByRole('contentinfo');
      expect(await footer.evaluate(element => getComputedStyle(element).backgroundColor))
        .toBe(await page.getByRole('banner').evaluate(element => getComputedStyle(element).backgroundColor));
      const github = footer.getByRole('link', { name: 'System Bootstrapper on GitHub', exact: true });
      await github.scrollIntoViewIfNeeded();
      await expect(github).toBeVisible();
      await expect(github).toHaveCSS('color', 'rgb(255, 255, 255)');
      const layout = await github.evaluate(link => {
        const box = link.getBoundingClientRect();
        const footer = link.closest('footer')!.getBoundingClientRect();
        return { center: (box.left + box.right) / 2, footerCenter: (footer.left + footer.right) / 2,
          withinViewport: box.left >= 0 && box.right <= innerWidth,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      expect(layout.withinViewport).toBe(true);
      expect(layout.horizontalOverflow).toBe(false);
      expect(Math.abs(layout.center - layout.footerCenter)).toBeLessThan(2);
      await github.focus();
      await expect(github).toBeFocused();
      if (destination === 'Privacy' || destination === 'Imprint') {
        await expect(page.getByRole('heading', { name: destination, exact: true })).toHaveCount(1);
        await expect(page.getByRole('note')).toContainText('Example operator details.');
        await page.screenshot({ path: test.info().outputPath(`${destination.toLowerCase()}-${viewport.width}.png`), fullPage: true, animations: 'disabled' });
      }
    }
  });
}

test('cleared published details show an unconfigured notice and never publish input placeholders', async ({ page }) => {
  await page.route('**/privacy-instance.json', route => route.fulfill({ json: {
    operatorName: '', operatorAddress: '', contactEmail: '', privacyNoticeUrl: '',
    accessLogRetention: '', additionalPrivacyText: '', SYNC_PASS: 'not-public'
  } }));
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Footer navigation' }).getByRole('button', { name: 'Imprint', exact: true }).click();
  await expect(page.getByText('The operator has not yet published contact details through this interface.', { exact: false })).toBeVisible();
  const visibleText = await page.locator('main').innerText();
  expect(visibleText).not.toContain('Max Mustermann');
  expect(visibleText).not.toContain('kontakt@example.com');
  expect(visibleText).not.toContain('not-public');
  await page.getByRole('navigation', { name: 'Footer navigation' }).getByRole('button', { name: 'Wizard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible();
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`Install focuses Quick Install and respects ${reducedMotion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.addInitScript(() => {
      const original = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (options) {
        (window as unknown as { installScroll: unknown }).installScroll = options;
        original.call(this, options);
      };
    });
    await page.goto('/');
    const install = page.getByRole('button', { name: 'Install System Bootstrapper', exact: true });
    await install.focus();
    await page.keyboard.press('Enter');
    const section = page.getByRole('region', { name: 'Quick Install', exact: true });
    await expect(section).toBeFocused();
    await expect.poll(() => section.evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(200);
    expect(await page.evaluate(() => (window as unknown as { installScroll: ScrollIntoViewOptions }).installScroll))
      .toEqual({ behavior: reducedMotion === 'reduce' ? 'instant' : 'smooth', block: 'start' });
    await expect(page.getByRole('tablist', { name: 'Main navigation' }).getByRole('tab', { name: 'Overview', exact: true }))
      .toHaveAttribute('aria-selected', 'true');
  });
}

test('Quick Install copies the actual command, translates feedback and handles unavailable clipboard', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { (window as unknown as { copiedCommand: string }).copiedCommand = text; }
    } });
  });
  await page.goto('/');
  const section = page.locator('section[aria-labelledby="quick-install-heading"]');
  const command = 'curl -fsSL https://github.com/kihyoun/system/releases/latest/download/quickstart.sh | sudo bash';
  await expect(section.locator('code')).toHaveText(command);
  const order = await page.locator('main section').evaluateAll(sections => sections.map(section => section.querySelector('h2')?.textContent ?? null));
  expect(order.slice(0, 3)).toEqual([null, 'How it works', 'Quick Install']);
  await section.getByRole('button', { name: 'Copy install command', exact: true }).click();
  await expect(section.getByRole('status')).toHaveText('Copied!');
  expect(await page.evaluate(() => (window as unknown as { copiedCommand: string }).copiedCommand)).toBe(command);
  await page.getByRole('button', { name: 'German', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'So funktioniert’s', exact: true })).toBeVisible();
  await expect(section.getByRole('status')).toHaveText('Kopiert!');
  await expect(section.locator('code')).toHaveText(command);
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); });
  await section.getByRole('button', { name: 'Installationsbefehl kopieren', exact: true }).click();
  await expect(section.getByRole('status')).toHaveText('Kopieren fehlgeschlagen. Markiere den Befehl und kopiere ihn manuell.');
});
