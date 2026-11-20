'use strict';
// Real multipart API and import scripts; service transports use a bounded fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const child = require('node:child_process');
const source = path.resolve(__dirname, '../..'), root = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-push-api-'));
fs.symlinkSync(path.join(source,'operations'),path.join(root,'operations'),'dir');
for (const folder of ['sync', 'system', 'state/.projects.env', 'nginx', 'project-bootstrap']) fs.mkdirSync(path.join(root, folder), {recursive: true});
for (const name of ['system/push.sh', 'nginx/wizard-aliases.js', 'nginx/application-aliases.js',
  'project-bootstrap/preserve-system-project.js', 'project-bootstrap/routing-impact.js', 'project-bootstrap/configuration-archive.js'])
  fs.copyFileSync(path.join(source, name), path.join(root, name));
fs.writeFileSync(path.join(root, 'project-bootstrap/apply.sh'), 'printf "%s\\n" "$*" >> ../apply-trace\n[[ ! -f ../fail-apply ]]\n');
process.chdir(path.join(root, 'sync'));
process.env.SYSTEM_CONFIG_DIR = path.join(root, 'state'); process.env.SYNC_USER = 'fixture'; process.env.SYNC_PASS = 'fixture-password';
let server, application;
const execute = child.execSync;
child.execSync = (command, options) => {
  assert.equal(command, 'cd ../system; bash push.sh', 'route-only Push must not stop GitLab or the platform');
  const {ConfigurationService}=require(path.join(source,'operations/dist/configuration/configuration.service'));
  const {NativeProcessRunner}=require(path.join(source,'operations/dist/runtime/process'));
  const routing={run(value){assert.equal(value.action,'apply');fs.appendFileSync(path.join(root,'apply-trace'),value.projects.join(' ')+'\n');if(fs.existsSync(path.join(root,'fail-apply')))throw Error('Injected routing failure');}};
  const service=new ConfigurationService(new NativeProcessRunner(),routing);
  const mode=service.push({root,state:path.join(root,'state'),archive:path.join(root,'bootstrapper.zip'),fingerprint:options.env.SYSTEM_PUSH_IMPACT});
  return Buffer.from('APPLY_MODE='+mode+'\nReady.\n');
};
child.execFile = child.spawn = () => { throw Error('GitLab and service transports are forbidden.'); };
const cube = fs.readFileSync(path.join(source, 'system/.docker.env.example'), 'utf8').slice(0, 1184);
const main = cube + '\nGITLAB_HOST="gitlab.example.test"\nGITLAB_RUNNER_SCALE="1"\n';
const project = cube + '\nPROJECT_NAME="sample"\nPROJECT_TEMPLATE="react"\nUSE_PROD_HOST="true"\nPROD_HOST="www.example.test"\nPROD_DOMAIN_MODE="0"\nUSE_BETA_HOST="false"\nUSE_REVIEW_HOST="false"\n';
function zip(data, selectedMain = main) {
  const archive = path.join(root, 'request.zip');
  child.execFileSync('python3', ['-c', 'import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n z.writestr(".docker.env",sys.argv[2])\n z.writestr(".projects.env/.sample.env",sys.argv[3])', archive, selectedMain, data]);
  return fs.readFileSync(archive);
}
const log = console.log; console.log = () => {};
const {bootstrap: startSync} = require(path.join(source, 'sync/dist/bootstrap'));
(async () => {
  application = await startSync({port: 0, host: '127.0.0.1'});
  server = application.getHttpServer();
  try {
    while (!server.listening) await new Promise(resolve => setTimeout(resolve, 5));
    const base = 'http://127.0.0.1:' + server.address().port;
    const login = await fetch(base + '/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'fixture', password: 'fixture-password'})});
    const token = (await login.json()).accessToken, headers = {Authorization: 'Bearer ' + token};
    while ((await (await fetch(base + '/status', {headers})).json()).defaultWizardSetupInProgress) await new Promise(resolve => setTimeout(resolve, 5));
    const mainFile = path.join(root, 'state/.docker.env'), projectFile = path.join(root, 'state/.projects.env/.sample.env');
    fs.writeFileSync(mainFile, main); fs.writeFileSync(projectFile, project);
    async function upload(route, data, fingerprint, selectedMain) {
      const form = new FormData(); form.append('bootstrapper.zip', new Blob([zip(data, selectedMain)]), 'bootstrapper.zip');
      if (fingerprint) form.append('impact', fingerprint);
      return fetch(base + route, {method: 'POST', headers, body: form});
    }
    const changed = project.replace('USE_REVIEW_HOST="false"', 'USE_REVIEW_HOST="true"') + 'REVIEW_HOST="review.example.test"\nREVIEW_DOMAIN_MODE="1"\nREVIEW_DEPLOY_MODE="0"\n';
    let response = await upload('/config/impact', changed); assert.equal(response.status, 200);
    const plan = await response.json(); assert.equal(plan.mode, 'routing'); assert.deepEqual(plan.projects, ['sample']);
    assert.equal(fs.readFileSync(projectFile, 'utf8'), project, 'preflight must not change saved state');
    assert(!fs.existsSync(path.join(root, 'apply-trace')));
    response = await upload('/config/zip', changed + 'BETA_HOST="changed.example.test"\n', plan.fingerprint);
    assert.equal(response.status, 409, 'a different reviewed plan cannot be applied');
    response = await upload('/config/zip', changed, plan.fingerprint); assert.equal(response.status, 200);
    const applied = await response.json(); assert.equal(applied.applyMode, 'routing'); assert.equal(applied.status.needRestart, false);
    assert.equal(fs.readFileSync(projectFile, 'utf8'), changed);
    assert.equal(fs.readFileSync(path.join(root, 'apply-trace'), 'utf8'), 'sample\n');
    assert.equal((await fetch(base + '/status', {headers})).status, 200, 'Sync remains available after routing Push');
    response = await upload('/config/impact', changed, null, main.replace('SCALE="1"', 'SCALE="2"'));
    assert.equal((await response.json()).mode, 'restart', 'Wizard must announce a main configuration restart');
    fs.writeFileSync(path.join(root, 'fail-apply'), 'fail');
    response = await upload('/config/zip', project); assert.equal(response.status, 500);
    assert.equal(fs.readFileSync(projectFile, 'utf8'), changed, 'failed apply restores the previous saved project');
    assert.equal(fs.readFileSync(mainFile, 'utf8'), main);
    assert.equal((await fetch(base + '/status', {headers})).status, 200);
    log('PASS: authenticated preflight, stale-plan rejection, route-only Push availability, scoped apply and failed-apply saved-state rollback.');
  } finally {
    console.log = log; if (application) await application.close(); fs.rmSync(root, {recursive: true, force: true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
