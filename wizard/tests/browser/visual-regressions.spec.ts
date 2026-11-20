import { expect, test, type Locator, type Page } from '@playwright/test';
import Helper from '../../src/api/Helper';

const syncOrigin = 'https://sync.visual.test';
const blue = 'rgb(33, 150, 243)';
const connectedColor = 'rgb(245, 0, 87)';
const lightCanvas = 'rgb(250, 250, 250)';
const white = 'rgb(255, 255, 255)';

async function mockSync(page: Page) {
  const unexpected: string[] = [];
  const configuration = Helper.textLogo + `
GITLAB_HOST='gitlab.visual.test'
GITLAB_REGISTRY_HOST='registry.visual.test'
GITLAB_RUNNER_SCALE='4'
SYNC_ENABLE='true'
SYNC_HOST='sync.visual.test'
SYNC_DOMAIN_MODE='2'
WIZARD_ENABLE='true'
WIZARD_HOST='wizard.visual.test'
WIZARD_DOMAIN_MODE='2'
`;
  await page.route(`${syncOrigin}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'Authorization, Content-Type',
      'access-control-allow-methods': 'GET, POST, OPTIONS'
    };
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers });
      return;
    }
    const key = `${request.method()} ${url.pathname}`;
    let body: unknown;
    switch (key) {
      case 'POST /login':
      case 'POST /token':
        body = { accessToken: 'visual-test-access', refreshToken: 'visual-test-refresh' };
        break;
      case 'POST /logout':
        body = { message: 'Logged out.' };
        break;
      case 'GET /config/main':
        body = { data: configuration };
        break;
      case 'GET /config/projects':
        body = [];
        break;
      case 'GET /projects/namespaces':
        body = { namespaces: [{ id: 17, path: 'example-team' }] };
        break;
      case 'GET /projects/availability':
        expect(url.searchParams.get('namespaceId')).toBe('17');
        expect(url.searchParams.get('projectKey')).toBe('visualtest');
        body = { availability: 'available' };
        break;
      default:
        unexpected.push(key);
        await route.fulfill({ status: 400, headers, json: { message: 'Unexpected visual test request' } });
        return;
    }
    await route.fulfill({ headers, json: body });
  });
  return unexpected;
}

function connectionGroup(page: Page, name: 'Connect' | 'Disconnect') {
  return page.getByRole('group').filter({
    has: page.getByRole('button', { name, exact: true })
  });
}

async function connect(page: Page) {
  await page.getByRole('tablist', { name: 'Main navigation' }).getByRole('tab', { name: 'Wizard', exact: true }).click();
  await connectionGroup(page, 'Connect').getByRole('button').first().click();
  const dialog = page.getByRole('dialog', { name: 'Connect', exact: true });
  await dialog.getByLabel('Server Address', { exact: true }).fill(syncOrigin);
  await dialog.getByLabel('Username', { exact: true }).fill('visual-test-user');
  await dialog.getByLabel('Password', { exact: true }).fill('visual-test-password');
  await dialog.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
}

async function fetchConfiguration(page: Page) {
  await page.getByRole('button', { name: 'Synchronize', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Fetch', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Fetch', exact: true })).toBeHidden();
  await expect(page.getByText('Import finished.', { exact: true }).first()).toBeVisible();
}

async function surfaceColor(control: Locator) {
  return control.evaluate(element => {
    let current: Element | null = element.parentElement;
    while (current) {
      const color = getComputedStyle(current).backgroundColor;
      if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
      current = current.parentElement;
    }
    return 'transparent';
  });
}

async function expectSeparatedNamespaceLabel(namespace: Locator) {
  const layout = await namespace.evaluate(element => {
    const select = element as HTMLSelectElement;
    const label = Array.from(select.labels || []).find(item => item.textContent === 'GitLab namespace');
    if (!label) throw new Error('Namespace selection has no associated visible label.');
    const labelBox = label.getBoundingClientRect();
    const selectBox = select.getBoundingClientRect();
    const style = getComputedStyle(select);
    return {
      label: { top: labelBox.top, bottom: labelBox.bottom, width: labelBox.width },
      text: {
        top: selectBox.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
        bottom: selectBox.bottom - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom)
      }
    };
  });
  expect(layout.label.width).toBeGreaterThan(0);
  expect(layout.text.bottom).toBeGreaterThan(layout.text.top);
  expect(layout.label.bottom + 2).toBeLessThanOrEqual(layout.text.top);
}

async function expectSeparatedProjectNavigation(dialog: Locator, namespace: Locator, stacked: boolean) {
  const navigation = await dialog.locator('.MuiStepper-root').evaluate(element => {
    const boxes = [element, ...element.querySelectorAll('.MuiStepLabel-label, .MuiStepIcon-root, button:not(.MuiStepButton-root)')]
      .map(item => item.getBoundingClientRect())
      .filter(box => box.width > 0 && box.height > 0);
    return {
      right: Math.max(...boxes.map(box => box.right)),
      bottom: Math.max(...boxes.map(box => box.bottom))
    };
  });
  const fields = await namespace.evaluate(element => {
    const grid = element.closest('.MuiGrid-root');
    if (!grid) throw new Error('Project fields have no layout container.');
    const box = grid.getBoundingClientRect();
    return { left: box.left, top: box.top };
  });
  if (stacked) {
    expect(navigation.bottom).toBeLessThanOrEqual(fields.top);
  } else {
    expect(navigation.right).toBeLessThanOrEqual(fields.left);
  }
}

test('light canvas separates white panels and connected controls retain the established red accent', async ({ page }) => {
  const unexpected = await mockSync(page);
  await page.goto('/');
  await page.getByRole('tablist', { name: 'Main navigation' }).getByRole('tab', { name: 'Wizard', exact: true }).click();
  const connectButton = page.getByRole('button', { name: 'Connect', exact: true });
  const generalTab = page.getByRole('tab', { name: 'General', exact: true });
  await expect(page.locator('body')).toHaveCSS('background-color', lightCanvas);
  await expect(connectButton).toHaveCSS('background-color', blue);
  expect(await surfaceColor(connectButton)).toBe(white);
  expect(await surfaceColor(generalTab)).toBe(white);

  await connect(page);
  const connectedButtons = connectionGroup(page, 'Disconnect').getByRole('button');
  await expect(connectedButtons).toHaveCount(2);
  for (const button of await connectedButtons.all()) {
    await expect(button).toHaveCSS('background-color', connectedColor);
  }
  await fetchConfiguration(page);
  await expect(page.locator('body')).toHaveCSS('background-color', lightCanvas);
  expect(await surfaceColor(generalTab)).toBe(white);
  await page.screenshot({ path: test.info().outputPath('connected-light.png'), animations: 'disabled' });

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.mouse.move(0, 0);
  await expect(connectButton).toBeVisible();
  await expect(connectButton).toHaveCSS('background-color', blue);
  expect(unexpected).toEqual([]);
});

test('workspace connection, draft configuration and selected tab survive Overview and Privacy navigation', async ({ page }) => {
  const unexpected = await mockSync(page);
  await page.route('**/privacy-instance.json', route => route.fulfill({ json: {
    operatorName: 'Published Operator', operatorAddress: 'A published address', contactEmail: 'public@example.test',
    privacyNoticeUrl: 'javascript:alert(1)', accessLogRetention: '', additionalPrivacyText: '<script>not executable</script>',
    SYNC_PASS: 'not-public', accessToken: 'not-public'
  } }));
  await page.goto('/');
  await connect(page);
  await fetchConfiguration(page);
  await page.getByLabel('GITLAB_HOST', { exact: true }).fill('gitlab.unsaved.test');
  await page.getByRole('tab', { name: 'Website', exact: true }).click();
  await page.getByLabel('Operator name', { exact: true }).fill('Unsaved Operator');
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How it works', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeHidden();
  await expect(page.locator('#main-panel-overview')).not.toContainText('gitlab.unsaved.test');

  const footer = page.getByRole('navigation', { name: 'Footer navigation' });
  await footer.getByRole('button', { name: 'Privacy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Privacy', exact: true })).toBeVisible();
  await expect(page.getByText('Published Operator', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Read the operator’s additional privacy notice', exact: true })).toHaveCount(0);
  await expect(page.locator('main').getByText('Unsaved Operator', { exact: true })).toHaveCount(0);
  await expect(page.locator('main').getByText('not-public', { exact: true })).toHaveCount(0);
  await footer.getByRole('button', { name: 'Imprint', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Imprint', exact: true })).toBeVisible();
  await footer.getByRole('button', { name: 'Wizard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(page.getByLabel('Operator name', { exact: true })).toHaveValue('Unsaved Operator');
  await page.getByRole('tab', { name: 'Projects', exact: true }).click();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('tablist', { name: 'Main navigation' }).getByRole('tab', { name: 'Wizard', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Projects', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await expect(page.getByLabel('GITLAB_HOST', { exact: true })).toHaveValue('gitlab.unsaved.test');
  expect(unexpected).toEqual([]);
});

test('switching themes preserves dark surfaces and the connected accent', async ({ page }) => {
  const unexpected = await mockSync(page);
  await page.goto('/');
  await connect(page);
  await page.getByLabel('Dark', { exact: true }).check();
  await page.mouse.move(0, 0);
  await expect(page.getByLabel('Light', { exact: true })).toBeChecked();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(48, 48, 48)');
  expect(await surfaceColor(page.getByRole('tab', { name: 'General', exact: true })))
    .toBe('rgb(66, 66, 66)');
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true }))
    .toHaveCSS('background-color', connectedColor);
  await page.screenshot({ path: test.info().outputPath('connected-dark.png'), animations: 'disabled' });
  await page.getByLabel('Light', { exact: true }).uncheck();
  await page.mouse.move(0, 0);
  await expect(page.locator('body')).toHaveCSS('background-color', lightCanvas);
  expect(await surfaceColor(page.getByRole('tab', { name: 'General', exact: true }))).toBe(white);
  expect(unexpected).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`namespace label stays above the empty placeholder and selected value at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const unexpected = await mockSync(page);
    await page.goto('/');
    await connect(page);
    await fetchConfiguration(page);
    await page.getByRole('tab', { name: 'Projects', exact: true }).click();
    await page.getByRole('button', { name: 'Add Project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Create Project Configuration', exact: true });
    const namespace = dialog.getByRole('combobox', { name: 'GitLab namespace', exact: true });
    await expect(namespace).toBeVisible();
    await expect(namespace).toHaveValue('');
    await expect(namespace.locator('option:checked')).toHaveText('Select namespace');
    await expectSeparatedNamespaceLabel(namespace);
    await expectSeparatedProjectNavigation(dialog, namespace, viewport.width < 900);
    await namespace.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`namespace-empty-${viewport.width}.png`), animations: 'disabled' });

    await namespace.selectOption('17');
    await expect(namespace).toHaveValue('17');
    await expect(namespace.locator('option:checked')).toHaveText('example-team');
    await expectSeparatedNamespaceLabel(namespace);
    await expectSeparatedProjectNavigation(dialog, namespace, viewport.width < 900);
    await dialog.getByLabel('Project Key', { exact: true }).fill('visualtest');
    await expect(dialog.getByText('Available in selected namespace.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    await namespace.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath(`namespace-selected-${viewport.width}.png`), animations: 'disabled' });
    expect(unexpected).toEqual([]);
  });
}
