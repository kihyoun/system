import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import JSZip from 'jszip';

test('configuration UI survives navigation and produces an importable signed backup', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'How it works', exact: true })).toBeVisible();
  await page.getByRole('tablist', { name: 'Main navigation' }).getByRole('tab', { name: 'Wizard', exact: true }).click();
  await expect(page.getByText('System Bootstrapper Control Panel')).toBeVisible();
  await page.getByRole('tab', { name: 'Projects', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add Project', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'bootstrapper.zip', exact: true }).click();
  const backup = await downloaded;
  expect(backup.suggestedFilename()).toBe('bootstrapper.zip');
  expect(await backup.failure()).toBe(null);
  const archivePath = await backup.path();
  if (!archivePath) throw new Error('Backup download has no local file.');
  const zip = await JSZip.loadAsync(await fs.readFile(archivePath));
  expect(zip.file('bootstrapper.json')).not.toBe(null);
  const env = await zip.file('.docker.env')!.async('string');
  expect(env[807]).toBe('$');
  expect(crypto.createHash('md5').update(env.slice(0, 1184)).digest('hex'))
    .toBe('bd4a8426355824593a5e21ad759830c1');
  const json = JSON.parse(await zip.file('bootstrapper.json')!.async('string'));
  expect(json).toHaveProperty('main');
  await page.screenshot({ path: 'test-results/wizard-modernized.png', fullPage: true });
  await page.goto('/configuration');
  await expect(page.getByText('System Bootstrapper Control Panel')).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Main navigation' }).getByRole('tab', { name: 'Wizard', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'General', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
