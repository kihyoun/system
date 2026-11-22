import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { ConfigurationBackupArchive } from '../host/configurationBackupArchive';
interface SmokeLocator {
  getByRole(role: string, options: { name: string; exact?: boolean }): SmokeLocator;
  getByText(text: string, options?: { exact?: boolean }): SmokeLocator;
  locator(selector: string): SmokeLocator;
  waitFor(): Promise<void>;
  click(): Promise<void>;
  getAttribute(name: string): Promise<string | null>;
  innerText(): Promise<string>;
  evaluate<T>(fn: (element: Element) => T): Promise<T>;
}
interface SmokeDownload {
  suggestedFilename(): string;
  failure(): Promise<string | null>;
  path(): Promise<string | null>;
}
interface SmokePage extends SmokeLocator {
  route(
    pattern: string,
    handler: (route: {
      request(): { url(): string };
      continue(): Promise<void>;
      abort(): Promise<void>;
    }) => Promise<void>,
  ): Promise<void>;
  on(event: 'pageerror', handler: (error: Error) => void): void;
  goto(
    url: string,
    options: { waitUntil: string; timeout?: number },
  ): Promise<{ status(): number } | null>;
  url(): string;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  waitForEvent(event: 'download'): Promise<SmokeDownload>;
}
interface SmokeDriver {
  chromium: {
    launch(options: { headless: boolean }): Promise<{
      newPage(options: { reducedMotion: string }): Promise<SmokePage>;
      close(): Promise<void>;
    }>;
  };
}
/** Optional pinned browser driver; all verification logic belongs to the shared CLI implementation. */
@Injectable()
export class BrowserSmokeService {
  async run(root: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    if (!path.isAbsolute(root)) {
      throw Error('absolute-browser-dependencies-required');
    }

    signal?.throwIfAborted();
    const driver = createRequire(path.join(root, 'package.json'))('playwright') as SmokeDriver;
    const base = new URL(env.WIZARD_BASE_URL || 'http://wizard-candidate');
    const evidence = env.WIZARD_EVIDENCE_DIR || '/evidence';
    fs.mkdirSync(evidence, { recursive: true });
    const browser = await driver.chromium.launch({ headless: true });
    const cancel = () => {
      void browser.close();
    };
    signal?.addEventListener('abort', cancel, { once: true });

    if (signal?.aborted) {
      cancel();
    }

    let page: SmokePage | undefined;
    try {
      page = await browser.newPage({ reducedMotion: 'reduce' });
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === base.origin ? route.continue() : route.abort(),
      );
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const response = await page.goto(new URL('/', base).href, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      assert(response && response.status() === 200, 'Candidate HTTP response failed');
      const navigation = page.getByRole('tablist', { name: 'Main navigation', exact: true });
      await page.getByRole('heading', { name: 'You build it. You own it.', exact: true }).waitFor();
      await page.getByRole('heading', { name: 'How it works', exact: true }).waitFor();
      assert.strictEqual(
        await navigation
          .getByRole('tab', { name: 'Overview', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      for (const name of [
        'Prepare your platform',
        'Connect and configure',
        'Create your first project',
      ]) {
        await page.getByRole('heading', { name, exact: true }).waitFor();
      }
      await page.getByRole('button', { name: 'Install System Bootstrapper', exact: true }).click();
      const install = page.getByRole('region', { name: 'Quick Install', exact: true });
      assert(
        await install.evaluate((element) => document.activeElement === element),
        'Install must focus Quick Install',
      );
      const top = await install.evaluate((element) => element.getBoundingClientRect().top);
      assert(top >= 0 && top < 200, 'Install must scroll Quick Install beneath the toolbar');
      assert.strictEqual(
        await install.locator('code').innerText(),
        'curl -fsSL https://github.com/kihyoun/system/releases/latest/download/quickstart.sh | sudo bash',
      );
      await install.getByRole('button', { name: 'Copy install command', exact: true }).waitFor();
      assert.strictEqual(
        await navigation
          .getByRole('tab', { name: 'Overview', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      await page.screenshot({ path: path.join(evidence, 'overview.png'), fullPage: true });
      await navigation.getByRole('tab', { name: 'Wizard', exact: true }).click();
      await page.getByText('System Bootstrapper Control Panel', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Connect', exact: true }).waitFor();
      await page.getByRole('tab', { name: 'Projects', exact: true }).click();
      await page.getByRole('button', { name: 'Add Project', exact: true }).waitFor();
      await navigation.getByRole('tab', { name: 'Overview', exact: true }).click();
      await page.getByRole('heading', { name: 'How it works', exact: true }).waitFor();
      await page.getByRole('link', { name: 'Read the handbook', exact: true }).click();
      await page.getByRole('heading', { name: '0. Getting Started', exact: true }).waitFor();
      assert.strictEqual(
        await navigation
          .getByRole('tab', { name: 'Docs', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      assert.strictEqual(new URL(page.url()).hash, '#docs/getting-started');
      await page.screenshot({ path: path.join(evidence, 'docs.png'), fullPage: true });
      await navigation.getByRole('tab', { name: 'Wizard', exact: true }).click();
      assert.strictEqual(
        await page
          .getByRole('tab', { name: 'Projects', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      await page.getByRole('button', { name: 'Add Project', exact: true }).waitFor();
      await page.getByRole('tab', { name: 'General', exact: true }).click();
      await page.getByRole('button', { name: 'Backup', exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'bootstrapper.zip', exact: true }).click();
      const download = await downloading;
      assert.strictEqual(download.suggestedFilename(), 'bootstrapper.zip');
      assert.strictEqual(await download.failure(), null);
      const downloaded = await download.path();
      assert(downloaded);
      const zip = new ConfigurationBackupArchive(fs.readFileSync(downloaded));
      const env = zip.read('.docker.env').toString();
      assert.strictEqual(env[807], '$');
      assert.strictEqual(
        crypto.createHash('md5').update(env.slice(0, 1184)).digest('hex'),
        'bd4a8426355824593a5e21ad759830c1',
      );
      assert((JSON.parse(zip.read('bootstrapper.json').toString()) as { main?: unknown }).main);
      await page.screenshot({ path: path.join(evidence, 'wizard.png'), fullPage: true });
      const nested = await page.goto(new URL('/nested/check', base).href, {
        waitUntil: 'networkidle',
      });
      assert(nested && nested.status() === 200, 'SPA subpage HTTP response failed');
      await page.getByRole('heading', { name: 'How it works', exact: true }).waitFor();
      const configuration = await page.goto(new URL('/configuration', base).href, {
        waitUntil: 'networkidle',
      });
      assert(
        configuration && configuration.status() === 200,
        'Wizard direct entry HTTP response failed',
      );
      await page.getByText('System Bootstrapper Control Panel', { exact: true }).waitFor();
      assert.strictEqual(
        await navigation
          .getByRole('tab', { name: 'Wizard', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      assert.deepStrictEqual(errors, [], 'Candidate has browser runtime errors');
      fs.writeFileSync(
        path.join(evidence, 'browser.json'),
        JSON.stringify({
          http: true,
          renderedUI: true,
          projects: true,
          spa: true,
          configurationBackup: true,
          cubeSignature: true,
          overviewNavigation: true,
          quickInstall: true,
          docs: true,
        }),
      );
    } catch (error) {
      if (page) {
        await page
          .screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true })
          .catch(() => undefined);
      }

      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
      await browser.close();
    }
  }
}
