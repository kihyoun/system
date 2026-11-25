import {expect, test} from '@playwright/test';

for (const width of [900, 1024, 1440]) {
  for (const view of ['overview', 'wizard', 'docs']) {
    test(`desktop language and theme controls stay on one row at ${width}px in ${view}`, async ({page}) => {
      await page.setViewportSize({width, height: 1000});
      await page.goto('/');
      const header = page.getByRole('banner');
      const theme = header.getByRole('switch');
      await header.locator(`#main-tab-${view}`).click();
      // Navigation stays centered during the drawer transition, so wait for the final header width.
      const drawerWidth = view === 'overview' ? 0 : (await page.locator(view === 'docs' ? '#docs-drawer' : '#server-drawer').boundingBox())!.width;
      await expect.poll(async () => (await header.boundingBox())!.width).toBeCloseTo(width - drawerWidth, 0);
      for (const dark of [false, true]) {
        await theme.setChecked(dark);
        await header.locator('button[lang="en"]').click();
        const englishHeight = (await header.boundingBox())!.height;
        for (const locale of ['ko', 'en'] as const) {
          await header.locator(`button[lang="${locale}"]`).click();
          await expect(page.locator('html')).toHaveAttribute('lang', locale);
          await expect(theme).toHaveAccessibleName(locale === 'ko' ? (dark ? '라이트 모드' : '다크 모드') : (dark ? 'Light' : 'Dark'));
          await expect.poll(() => header.evaluate(element => {
            const language = element.querySelector('[role="group"]')!.getBoundingClientRect();
            const theme = element.querySelector('input[role="switch"]')!.closest('label')!.getBoundingClientRect();
            return Math.abs((language.top + language.bottom) / 2 - (theme.top + theme.bottom) / 2);
          })).toBeLessThan(2);
          expect((await header.boundingBox())!.height).toBeCloseTo(englishHeight, 0);
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        }
      }
    });
  }
}

for (const width of [320, 390, 1024, 1440]) {
  test(`Korean navigation, language selection and Docs fit at ${width}px`, async ({page}) => {
    await page.setViewportSize({width, height: 1000});
    await page.goto('/');
    const header = page.getByRole('banner');
    await header.getByRole('button', {name: 'Korean', exact: true}).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
    await expect(header.getByRole('button', {name: '한국어', exact: true})).toHaveAttribute('aria-pressed', 'true');
    for (const name of ['개요', 'Wizard', 'Docs']) {
      await header.getByRole('tab', {name, exact: true}).click();
      await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect.poll(async () => header.evaluate(element => {
        const nav = element.querySelector('nav')!.getBoundingClientRect();
        const title = element.querySelector('h6')!.getBoundingClientRect();
        const language = element.querySelector('[role="group"]')!.getBoundingClientRect();
        const separate = (a: DOMRect, b: DOMRect) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
        return separate(nav, title) && separate(nav, language) && separate(title, language);
      })).toBe(true);
    }
    await page.reload();
    await expect(header.getByRole('button', {name: '한국어', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await header.getByRole('button', {name: '영어', exact: true}).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
}

test('Korean, German and English switches preserve configuration edits and Docs deep links', async ({page}) => {
  await page.goto('/configuration');
  const host = page.getByRole('textbox', {name: 'GITLAB_HOST', exact: true});
  await host.fill('한글-operator.example.test');
  const header = page.getByRole('banner');
  await header.getByRole('button', {name: 'Korean', exact: true}).click();
  await expect(host).toHaveValue('한글-operator.example.test');
  await header.getByRole('button', {name: '독일어', exact: true}).click();
  await expect(host).toHaveValue('한글-operator.example.test');
  await header.getByRole('button', {name: 'Englisch', exact: true}).click();
  await expect(host).toHaveValue('한글-operator.example.test');
  await page.getByRole('tab', {name: 'Docs', exact: true}).click();
  await page.evaluate(() => {location.hash = '#docs/seed-recovery/verification-boundaries';});
  await header.getByRole('button', {name: 'Korean', exact: true}).click();
  await expect(page.locator('#docs-section-verification-boundaries')).toBeVisible();
  await expect(page).toHaveURL(/#docs\/seed-recovery\/verification-boundaries$/);
  await page.getByRole('tab', {name: 'Wizard', exact: true}).click();
  await expect(host).toHaveValue('한글-operator.example.test');
});

test('Korean Docs search and copy use translated labels and retain exact commands', async ({page, context}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs#docs/installation');
  await page.getByRole('banner').getByRole('button', {name: 'Korean', exact: true}).click();
  await page.getByRole('textbox', {name: '전체 문서 검색'}).fill('복구');
  expect(await page.getByRole('region', {name: '문서 검색 결과'}).getByRole('link').count()).toBeGreaterThan(0);
  await page.getByRole('button', {name: '문서 검색 지우기'}).click();
  await page.getByRole('button', {name: 'bash 예제 복사', exact: true}).first().click();
  await expect(page.getByRole('button', {name: '복사 완료', exact: true})).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('sudo');
  expect(copied).not.toMatch(/^\$ /m);
});
