'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {impact} = require('../../project-bootstrap/routing-impact');
const cube = fs.readFileSync(path.join(__dirname, '../../system/.docker.env.example'), 'utf8').slice(0, 1184);
const env = values => cube + Object.entries(values).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n';
const main = env({GITLAB_HOST: 'gitlab.example.test', GITLAB_RUNNER_SCALE: '1'});
const project = env({PROJECT_NAME: 'sample', PROJECT_TEMPLATE: 'react', USE_PROD_HOST: 'true', PROD_HOST: 'www.example.test',
  PROD_DOMAIN_MODE: '2', PROD_SSL: '/ssl/sample/fullchain.pem', PROD_SSL_KEY: '/ssl/sample/privkey.pem', USE_REVIEW_HOST: 'false'});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-routing-impact-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const current = path.join(root, 'current'), next = path.join(root, 'next');
  for (const folder of [current, next]) {
    fs.mkdirSync(path.join(folder, '.projects.env'), {recursive: true});
    fs.writeFileSync(path.join(folder, '.docker.env'), main);
    fs.writeFileSync(path.join(folder, '.projects.env/.sample.env'), project);
  }
  return {current, next, plan: () => impact(next, current), write: (data, name = '.projects.env/.sample.env') => fs.writeFileSync(path.join(next, name), data)};
}
test('existing application host, protocol, activation, certificate and alias edits select only their project', t => {
  const f = fixture(t);
  for (const edit of ['REVIEW_HOST="review.example.test"\nREVIEW_DOMAIN_MODE="1"\nREVIEW_DEPLOY_MODE="0"',
    'PROD_ALIASES="example.test"', 'BETA_HOST="beta.example.test"', 'PROD_SSL="/ssl/new/fullchain.pem"']) {
    f.write(project.replace('USE_REVIEW_HOST="false"', 'USE_REVIEW_HOST="true"').replace('PROD_SSL="/ssl/sample/fullchain.pem"', '') + edit + '\n');
    assert.deepEqual({...f.plan(), fingerprint: ''}, {mode: 'routing', projects: ['sample'], fingerprint: ''});
  }
});
test('timestamps and equivalent quoting do not restart services or invalidate the reviewed semantics', t => {
  const f = fixture(t), original = f.plan();
  f.write(project.replace('PROJECT_NAME="sample"', "export PROJECT_NAME='sample'") + '# created on later\n');
  assert.equal(f.plan().mode, 'none');
  assert.equal(f.plan().fingerprint, original.fingerprint);
  f.write(main + '# created on later\n', '.docker.env');
  assert.equal(f.plan().mode, 'none');
});
test('main, runner, repository identity, project membership and unknown changes conservatively require restart', t => {
  const f = fixture(t);
  for (const edit of ['GITLAB_RUNNER_SCALE="4"\n', 'UNRECOGNIZED="true"\n', '# BOOTSTRAPPER_REPOSITORY=changed\n']) {
    f.write(project + edit); assert.equal(f.plan().mode, 'restart');
  }
  f.write(project);
  f.write(main.replace('SCALE="1"', 'SCALE="4"'), '.docker.env'); assert.equal(f.plan().mode, 'restart');
  f.write(main, '.docker.env'); f.write(project.replace('sample', 'other')); assert.equal(f.plan().mode, 'restart');
  f.write(project); f.write(project, '.projects.env/.new.env'); assert.equal(f.plan().mode, 'restart');
});
test('invalid or expanded saved state never enters the selective apply path', t => {
  const f = fixture(t);
  for (const data of ['invalid', project + 'PRIVATE="$SECRET"\n', project + 'PROJECT_NAME="duplicate"\n']) {
    f.write(data); assert.equal(f.plan().mode, 'restart');
  }
});
test('server-owned managed Wizard state wins over stale uploads and is excluded from application changes', t => {
  const f = fixture(t);
  const owned = env({PROJECT_NAME: 'wizard', PROJECT_TEMPLATE: 'wizard', USE_PROD_HOST: 'true', PROD_HOST: 'wizard.example.test'}) +
    '# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify({defaultProject: true, template: 'wizard'})).toString('base64') + '\n';
  fs.writeFileSync(path.join(f.current, '.projects.env/.wizard.env'), owned);
  f.write('stale client wizard', '.projects.env/.wizard.env');
  assert.equal(f.plan().mode, 'none');
  f.write(project + 'PROD_ALIASES="example.test"\n'); assert.equal(f.plan().mode, 'routing');
});

test('the native Wizard omission of inactive main TLS paths does not restart an HTTP platform', t => {
  const f = fixture(t);
  const configured = main + 'GITLAB_DOMAIN_MODE="0"\nGITLAB_SSL="/ssl/inactive/cert.pem"\nGITLAB_SSL_KEY="/ssl/inactive/key.pem"\n';
  fs.writeFileSync(path.join(f.current, '.docker.env'), configured);
  f.write(main + 'GITLAB_DOMAIN_MODE="0"\n', '.docker.env');
  f.write(project + 'PROD_ALIASES="example.test"\n');
  assert.equal(f.plan().mode, 'routing');
  fs.writeFileSync(path.join(f.current, '.docker.env'), configured.replace('DOMAIN_MODE="0"', 'DOMAIN_MODE="2"'));
  f.write(main + 'GITLAB_DOMAIN_MODE="2"\n', '.docker.env');
  assert.equal(f.plan().mode, 'restart', 'active TLS changes must restart the platform');
});
