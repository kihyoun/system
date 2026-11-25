const fs = require('fs');
const assert = require('assert');
const {chromium} = require('playwright');
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
    await page.getByText('System Bootstrapper Control Panel', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Connect', exact: true}).waitFor();
    await page.getByRole('tab', {name: 'Projects', exact: true}).click();
    await page.getByRole('button', {name: 'Add Project', exact: true}).waitFor();
    await page.screenshot({path: '/evidence/wizard.png', fullPage: true});
    const nested = await page.goto('http://wizard-candidate/nested/check', {waitUntil: 'networkidle'});
    assert(nested.status() === 200, 'SPA subpage HTTP response failed');
    await page.getByText('System Bootstrapper Control Panel', {exact: true}).waitFor();
    assert.deepStrictEqual(errors, [], 'Candidate has browser runtime errors');
    fs.writeFileSync('/evidence/browser.json', JSON.stringify({http: true, renderedUI: true, projects: true, spa: true}));
  } catch (error) {
    if (page) await page.screenshot({path: '/evidence/failure.png', fullPage: true}).catch(() => undefined);
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
