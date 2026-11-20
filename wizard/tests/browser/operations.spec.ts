import {expect, test} from '@playwright/test';

test('connected operation dialogs expose explicit actions without starting setup, backup or pulls on opening', async ({page}) => {
  const calls: string[] = [];
  const id = 'a'.repeat(32);
  await page.route('**/fixture-sync/**', async route => {
    const request = route.request(), name = new URL(request.url()).pathname.replace('/fixture-sync', '');
    calls.push(request.method() + ' ' + name);
    const responses: Record<string, unknown> = {
      '/login': {accessToken:'fixture-token',refreshToken:'fixture-refresh'}, '/token': {accessToken:'fixture-token'},
      '/status': {needRestart:false},
      '/projects/wizard/preview-setup': {state:'not-configured'}, '/projects/namespaces': {state:'complete',namespaces:[{path:'example'}]},
      '/operations/credentials': {state:'complete',projects:['example/system'],observedAt:'2026-11-09T12:00:00Z',credentials:[
        {projectPath:'example/system',key:'RENOVATE_TOKEN',purpose:'Renovate',provider:'GitLab',configured:true,
          expiresAt:'2026-11-12',daysRemaining:3,status:'expiring',expirySource:'gitlab',renewalGuide:'#docs/dependency-updates'}
      ]},
      '/diagnostics': {registry:'https://registry.example.test',helper:'https://registry.gitlab.com',
        helperImage:'registry.gitlab.com/example/helper@sha256:' + 'b'.repeat(64),runners:['runner_docker_1'],context:'Sync controller process network; this does not establish runner or Docker-daemon connectivity'},
      '/diagnostics/connection': {target:'https://registry.example.test',context:'Sync controller process network; this does not establish runner or Docker-daemon connectivity',
        steps:[{name:'Registry HTTP',status:'passed',durationMs:4,code:'HTTP_401_CHALLENGE',detail:'Authentication is still unverified.'}]},
      '/command/backup': {id,state:'failed',phase:'harvest',error:'native-harvest-failed',configuration:{status:'unavailable'}}
    };
    if (!(name in responses)) { await route.fulfill({status:404,json:{message:'Unexpected fixture request'}}); return; }
    await route.fulfill({json:responses[name]});
  });
  await page.goto('/configuration');
  const operations = page.getByRole('group', {name:'Platform operations',exact:true});
  await expect(operations.getByRole('button', {name:'System diagnostics',exact:true})).toBeDisabled();
  await page.getByRole('button', {name:'Edit connection',exact:true}).click();
  const connect = page.getByRole('dialog');
  await connect.getByLabel('Server Address',{exact:true}).fill(new URL(page.url()).origin + '/fixture-sync');
  await connect.getByLabel('Username',{exact:true}).fill('fixture');
  await connect.getByLabel('Password',{exact:true}).fill('fixture-password');
  await connect.getByRole('button', {name:'Submit',exact:true}).click();
  await expect(connect).toBeHidden();
  await operations.getByRole('button', {name:'Set up development previews',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('button', {name:'Confirm setup / resume',exact:true})).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', {name:'Close',exact:true}).click();
  await operations.getByRole('button', {name:'Credential expiry',exact:true}).click();
  await expect(page.getByText('Days remaining: 3', {exact:true})).toBeVisible();
  await page.getByRole('dialog').getByRole('button', {name:'Close',exact:true}).click();
  await operations.getByRole('button', {name:'System diagnostics',exact:true}).click();
  const diagnostics = page.getByRole('dialog');
  await expect(diagnostics.getByRole('button', {name:'Check connection',exact:true})).toBeEnabled();
  expect(calls.filter(call => call.startsWith('POST ') && !['POST /login','POST /token'].includes(call))).toEqual([]);
  await diagnostics.getByRole('button', {name:'Check connection',exact:true}).click();
  await expect(diagnostics.getByRole('table')).toContainText('HTTP_401_CHALLENGE');
  expect(calls).not.toContain('POST /diagnostics/pull');
  await diagnostics.getByRole('button', {name:'Close',exact:true}).click();
  await operations.getByRole('button', {name:'Harvest and configuration backup',exact:true}).click();
  const backup = page.getByRole('dialog');
  expect(calls).not.toContain('POST /command/backup');
  await backup.getByRole('button', {name:'Back up Seed and configuration',exact:true}).click();
  await expect(backup).toContainText('Backup failed. Previous completed Seeds are retained.');
  await expect(backup.getByRole('button', {name:'Download configuration ZIP',exact:true})).toHaveCount(0);
  await backup.getByRole('button', {name:'Close',exact:true}).click();
  await page.getByRole('button', {name:'German',exact:true}).click();
  await expect(page.getByRole('group', {name:'Plattformbetrieb',exact:true}).getByRole('button', {name:'Ablauf von Zugangsdaten',exact:true})).toBeVisible();
  expect(calls.some(call => /\/config\//.test(call) || /\/preview-setup\/(apply|preflight)/.test(call))).toBe(false);
});
