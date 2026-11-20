import { expect, test } from '@playwright/test';

test('language changes preserve edited configuration and the shared Docs sidebar is wider', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/configuration');
  const host = page.getByRole('textbox', { name: 'GITLAB_HOST', exact: true });
  await host.fill('edited.example.test');
  const serverDrawer = page.locator('#server-drawer .MuiDrawer-paper');
  await expect(serverDrawer).toBeVisible();
  const serverWidth = (await serverDrawer.boundingBox())!.width;
  await page.getByRole('banner').getByRole('button', { name: 'German', exact: true }).click();
  await expect(host).toHaveValue('edited.example.test');
  await expect(page.getByRole('button', { name: 'Verbinden', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Docs', exact: true }).click();
  const docsDrawer = page.locator('#docs-drawer .MuiDrawer-paper');
  await expect(docsDrawer).toBeVisible();
  expect((await docsDrawer.boundingBox())!.width).toBeGreaterThan(serverWidth + 100);
  await expect(page.getByRole('navigation', { name: 'Dokumentationskapitel' })).toBeVisible();
  await page.getByRole('button', { name: 'Handbuchleiste schließen' }).click();
  const open = page.getByRole('button', { name: 'Handbuchleiste öffnen' });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await open.click();
  await expect(open).toBeHidden();
  await page.getByRole('tab', { name: 'Wizard', exact: true }).click();
  await expect(host).toHaveValue('edited.example.test');
});

test('German chapter prose, search, deep links and copy controls work together', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs#docs/seed-recovery/verification-boundaries');
  await page.getByRole('banner').getByRole('button', { name: 'German', exact: true }).click();
  await expect(page.locator('#docs-section-verification-boundaries')).toBeVisible();
  await expect(page).toHaveURL(/#docs\/seed-recovery\/verification-boundaries$/);
  await page.getByRole('textbox', { name: 'Gesamte Dokumentation durchsuchen' }).fill('Wiederherstellung');
  const results = page.getByRole('region', { name: 'Suchergebnisse der Dokumentation' });
  expect(await results.getByRole('link').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Dokumentationssuche leeren' }).click();
  await page.goto('/docs#docs/installation');
  const copy = page.getByRole('button', { name: 'bash-Beispiel kopieren', exact: true }).first();
  await copy.click();
  await expect(page.getByRole('button', { name: 'Kopiert', exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('sudo');
  expect(copied).not.toMatch(/^\$ /m);
  await page.getByRole('banner').getByRole('button', { name: 'Englisch', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: '1. Installation · local Ubuntu / WSL2' })).toBeVisible();
});
