#!/usr/bin/env node
'use strict';
// Run the built Wizard's actual Fetch -> Backup exporter, including its models
// and ZIP implementation. Candidate preparation supplies that exact artifact.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {impact} = require('../../project-bootstrap/routing-impact');
function run(exporter) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'configuration-routing-export-'));
  let sequence = 0;
  const exportZip = input => {
    const name = String(sequence++), filename = path.join(root, name + '.json'), archive = path.join(root, name + '.zip'), output = path.join(root, name);
    fs.writeFileSync(filename, JSON.stringify(input), {mode: 0o600});
    execFileSync(process.execPath, [exporter, filename, archive], {stdio: 'pipe', timeout: 30000});
    fs.mkdirSync(output);
    execFileSync('unzip', ['-q', archive, '-d', output], {stdio: 'pipe', timeout: 10000});
    return output;
  };
  try {
    const cube = fs.readFileSync(path.join(__dirname, '../../system/.docker.env.example'), 'utf8').slice(0, 1184);
    const values = {PROJECT_NAME: 'sample', PROJECT_TEMPLATE: 'empty', PROD_DEPLOY_MODE: '0', BETA_DEPLOY_MODE: '0', REVIEW_DEPLOY_MODE: '0',
      USE_PROD_HOST: 'true', PROD_HOST: 'www.example.test', PROD_DOMAIN_MODE: '2', PROD_SSL: '/ssl/sample/fullchain.pem', PROD_SSL_KEY: '/ssl/sample/privkey.pem',
      USE_BETA_HOST: 'true', BETA_HOST: 'beta.example.test', BETA_DOMAIN_MODE: '0', USE_REVIEW_HOST: 'false', GITLAB_RUNNER_SCALE: '0', GITLAB_RUNNER_TOKEN: ''};
    const project = cube + '\n' + Object.entries(values).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n';
    const saved = exportZip({main: {data: cube + '\nGITLAB_HOST="gitlab.example.test"\nGITLAB_RUNNER_SCALE="0"\n'}, projects: [{data: project}]});
    const main = fs.readFileSync(path.join(saved, '.docker.env'), 'utf8');
    const initial = fs.readFileSync(path.join(saved, '.projects.env/.sample.env'), 'utf8');
    assert.match(initial, /^# BOOTSTRAPPER_REPOSITORY=null$/m, 'initial Wizard Save has no created repository');
    const repository = {id: 17, namespaceId: 1, path: 'root/sample', defaultBranch: 'main', webUrl: 'https://gitlab.example.test/root/sample'};
    const receipt = {operation: 'a'.repeat(48), fingerprint: 'b'.repeat(64), namespaceId: '1', template: 'empty', defaultProject: false, state: 'complete', repository};
    const authoritative = '# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify(receipt)).toString('base64');
    for (const data of [initial, initial.replace(/^# BOOTSTRAPPER_REPOSITORY=.*\n/m, '')]) {
      const baseline = data + '\n' + authoritative + '\n', current = path.join(root, 'current-' + sequence);
      fs.mkdirSync(path.join(current, '.projects.env'), {recursive: true});
      fs.writeFileSync(path.join(current, '.docker.env'), main);
      fs.writeFileSync(path.join(current, '.projects.env/.sample.env'), baseline);
      const fetchInput = content => ({main: {data: main}, projects: [{filename: '.sample.env', data: content, repository, namespaceId: 1, template: 'empty'}]});
      const unchanged = exportZip(fetchInput(baseline));
      assert.equal(impact(unchanged, current).mode, 'none', 'first authenticated Fetch/export only derives repository metadata');
      const changed = baseline.replace('USE_REVIEW_HOST="false"', 'USE_REVIEW_HOST="true"') +
        '\nREVIEW_HOST="review.example.test"\nREVIEW_DOMAIN_MODE="1"\nPROD_ALIASES="example.test"\n';
      const next = exportZip(fetchInput(changed)), exported = fs.readFileSync(path.join(next, '.projects.env/.sample.env'), 'utf8');
      assert.deepEqual(exported.split('\n').filter(line => line.startsWith('# BOOTSTRAPPER_PROJECT=')), [authoritative], 'export preserves exact server receipt bytes');
      const metadata = exported.split('\n').filter(line => line.startsWith('# BOOTSTRAPPER_REPOSITORY='));
      assert.equal(metadata.length, 1);
      assert.deepEqual(JSON.parse(decodeURIComponent(metadata[0].slice('# BOOTSTRAPPER_REPOSITORY='.length))), repository);
      const result = impact(next, current);
      assert.equal(result.mode, 'routing'); assert.deepEqual(result.projects, ['sample']);
      const tampered = exportZip({...fetchInput(changed), projects: [{...fetchInput(changed).projects[0], repository: {...repository, id: 18}}]});
      assert.equal(impact(tampered, current).mode, 'restart', 'Fetch metadata cannot override the retained receipt identity');
    }
    console.log('PASS actual Wizard Save/Fetch/ZIP export: derived repository metadata preserves selective routing and exact authoritative receipts.');
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
}
module.exports = {run};
if (require.main === module) {
  assert.equal(process.argv.length, 4); assert.equal(process.argv[2], '--exporter');
  run(path.resolve(process.argv[3]));
}
