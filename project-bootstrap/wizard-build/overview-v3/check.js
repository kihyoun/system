const fs = require('fs');
const assert = require('assert');
const {chromium} = require('playwright');
const JSZip = require('jszip');
const crypto = require('crypto');
(async () => {
  fs.mkdirSync('/evidence', {recursive: true});
  const browser = await chromium.launch({headless: true});
  let page;
  try {
    page = await browser.newPage();
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://wizard-candidate' ? route.continue() : route.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto('http://wizard-candidate/', {waitUntil: 'networkidle', timeout: 30000});
    assert(response.status() === 200, 'Candidate HTTP response failed');
    const navigation = page.getByRole('tablist', {name: 'Main navigation', exact: true});
    const hasOverview = await navigation.count() > 0;
    if (hasOverview) {
      await page.getByRole('heading', {name: 'Getting Started', exact: true}).waitFor();
      assert.strictEqual(await navigation.getByRole('tab', {name: 'Overview', exact: true}).getAttribute('aria-selected'), 'true');
      await page.screenshot({path: '/evidence/overview.png', fullPage: true});
      await navigation.getByRole('tab', {name: 'Wizard', exact: true}).click();
      assert.strictEqual(await navigation.getByRole('tab', {name: 'Wizard', exact: true}).getAttribute('aria-selected'), 'true');
    }
    await page.getByText('System Bootstrapper Control Panel', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Connect', exact: true}).waitFor();
    await page.getByRole('tab', {name: 'Projects', exact: true}).click();
    await page.getByRole('button', {name: 'Add Project', exact: true}).waitFor();
    if (hasOverview) {
      await navigation.getByRole('tab', {name: 'Overview', exact: true}).click();
      await page.getByRole('heading', {name: 'Getting Started', exact: true}).waitFor();
      await navigation.getByRole('tab', {name: 'Wizard', exact: true}).click();
      assert.strictEqual(await page.getByRole('tab', {name: 'Projects', exact: true}).getAttribute('aria-selected'), 'true');
      await page.getByRole('button', {name: 'Add Project', exact: true}).waitFor();
    }
    await page.getByRole('tab', {name: 'General', exact: true}).click();
    await page.getByRole('button', {name: 'Backup', exact: true}).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('menuitem', {name: 'bootstrapper.zip', exact: true}).click();
    const download = await downloading;
    assert.strictEqual(download.suggestedFilename(), 'bootstrapper.zip');
    assert.strictEqual(await download.failure(), null);
    const zip = await JSZip.loadAsync(fs.readFileSync(await download.path()));
    const env = await zip.file('.docker.env').async('string');
    assert.strictEqual(env[807], '$');
    assert.strictEqual(crypto.createHash('md5').update(env.slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
    assert(JSON.parse(await zip.file('bootstrapper.json').async('string')).main);
    await page.screenshot({path: '/evidence/wizard.png', fullPage: true});
    const nested = await page.goto('http://wizard-candidate/nested/check', {waitUntil: 'networkidle'});
    assert(nested.status() === 200, 'SPA subpage HTTP response failed');
    if (hasOverview) {
      await page.getByRole('heading', {name: 'Getting Started', exact: true}).waitFor();
      await page.getByRole('button', {name: 'Open Wizard', exact: true}).click();
    }
    await page.getByText('System Bootstrapper Control Panel', {exact: true}).waitFor();
    assert.deepStrictEqual(errors, [], 'Candidate has browser runtime errors');
    fs.writeFileSync('/evidence/browser.json', JSON.stringify({http: true, renderedUI: true, projects: true, spa: true, configurationBackup: true, cubeSignature: true, overviewNavigation: hasOverview}));
  } catch (error) {
    if (page) await page.screenshot({path: '/evidence/failure.png', fullPage: true}).catch(() => undefined);
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
