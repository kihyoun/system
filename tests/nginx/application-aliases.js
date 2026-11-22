'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const aliases = require('../../dist/modules/projects-routing/applicationAliases');
const cube = fs.readFileSync(path.join(__dirname, '../../config/system/.docker.env.example'), 'utf8').slice(0, 1184);
const env = values => cube + Object.entries(values).map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n') + '\n';
const main = env({WIZARD_HOST: 'wizard.example.test', WIZARD_DOMAIN_MODE: '2', WIZARD_ALIASES: 'oldwizard.example.test',
  GITLAB_HOST: 'gitlab.example.test', GITLAB_REGISTRY_HOST: 'registry.example.test', SYNC_HOST: 'sync.example.test'});
const project = (prefix = 'PROD', changes = {}) => env({PROJECT_NAME: 'sample', PROJECT_TEMPLATE: 'react',
  ['USE_' + prefix + '_HOST']: 'true', [prefix + '_HOST']: 'www.example.test', [prefix + '_DOMAIN_MODE']: '2',
  [prefix + '_ALIASES']: 'example.test old.example.test', [prefix + '_SSL']: '/ssl/sample/fullchain.pem',
  [prefix + '_SSL_KEY']: '/ssl/sample/privkey.pem', ...changes});

test('each application environment owns exact aliases with canonical HTTP/HTTPS and HTTP01', () => {
  for (const prefix of ['PROD', 'BETA', 'REVIEW']) for (const mode of ['0', '2']) {
    const selected = aliases.validate(main, [project(prefix, {[prefix + '_DOMAIN_MODE']: mode})]);
    const output = aliases.render(selected), scheme = mode === '2' ? 'https' : 'http';
    assert.equal(selected[0].environment, prefix);
    assert.equal(selected[0].project, 'sample');
    assert.equal((output.match(new RegExp('return 308 ' + scheme + '://www\\.example\\.test\\$request_uri;', 'g')) || []).length, 2);
    assert.equal((output.match(/location \^~ \/\.well-known\/acme-challenge\//g) || []).length, 2);
    assert.match(output, /try_files \$uri =404;/);
    assert.match(output, /listen 80;/); assert.match(output, /listen 443 ssl;/);
    assert.doesNotMatch(output, /proxy_pass|return 308 .*\$host/);
  }
});
test('invalid aliases, loops, ambiguous ownership and unsafe certificates fail before rendering', () => {
  for (const value of ['*.example.test', 'https://example.test', 'example.test:443', '127.0.0.1', 'example.test.',
    'x'.repeat(64) + '.test', 'www.example.test', 'example.test EXAMPLE.TEST', 'example.test;return'])
    assert.throws(() => aliases.validate(main, [project('PROD', {PROD_ALIASES: value})]), undefined, value);
  for (const changes of [{PROD_DOMAIN_MODE: '1'}, {PROD_DOMAIN_MODE: '3'}, {PROD_SSL: '/etc/cert.pem'},
    {PROD_SSL_KEY: '/ssl/../outside.key'}, {PROD_SSL_KEY: '/ssl/sample/fullchain.pem'}, {PROJECT_TEMPLATE: 'wizard'}])
    assert.throws(() => aliases.validate(main, [project('PROD', changes)]));
  assert.throws(() => aliases.validate(main, [project(), project('BETA', {PROJECT_NAME: 'other', BETA_HOST: 'beta.other.test'})]), /one environment owner/);
});
test('aliases reserve platform, Wizard alias and exact/wildcard application hosts', () => {
  for (const alias of ['wizard.example.test', 'gitlab.example.test', 'registry.example.test', 'sync.example.test', 'oldwizard.example.test'])
    assert.throws(() => aliases.validate(main, [project('PROD', {PROD_ALIASES: alias})]), /platform host|Wizard alias/);
  for (const mode of ['0', '1', '2', '3']) {
    const host = ['1', '3'].includes(mode) ? 'example.test' : 'old.example.test';
    assert.throws(() => aliases.validate(main, [project(), env({PROJECT_NAME: 'other', USE_BETA_HOST: 'true', BETA_HOST: host, BETA_DOMAIN_MODE: mode})]), /project host/);
  }
});
test('empty aliases retain historical routes and disabled aliases remain saved without a route', () => {
  assert.deepEqual(aliases.validate('PRIVATE="$VALUE"\n', ['PROJECT_NAME=legacy\n']), []);
  assert.equal(aliases.render([]), '');
  assert.deepEqual(aliases.validate(main, [project('PROD', {USE_PROD_HOST: 'false'})]), []);
});
test('real certificates must cover canonical and alias SANs and match a valid private key', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'application-alias-certificate-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const create = (name, names) => {
    const certificate = path.join(root, name + '.pem'), key = path.join(root, name + '.key');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate,
      '-days', '1', '-subj', '/CN=www.example.test', '-addext', 'subjectAltName=' + names.map(host => 'DNS:' + host).join(',')], {stdio: 'ignore'});
    return {certificate, key};
  };
  const valid = create('valid', ['www.example.test', 'example.test', 'old.example.test']);
  const missing = create('missing', ['www.example.test']);
  const route = aliases.validate(main, [project()])[0];
  aliases.certificates([{...route, ...valid}]);
  assert.throws(() => aliases.certificates([{...route, ...missing}]), /subject alternative names/);
  assert.throws(() => aliases.certificates([{...route, ...valid, key: missing.key}]), /do not match/);
  assert.throws(() => aliases.certificates([{...route, ...valid, certificate: path.join(root, 'absent.pem')}]), /unavailable/);
});

test('fresh recovery can import alias settings before Seed certificates, while an existing installation fails closed', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'application-alias-import-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const archive = path.join(root, 'archive'), current = path.join(root, 'current');
  fs.mkdirSync(path.join(archive, '.projects.env'), {recursive: true}); fs.mkdirSync(current);
  fs.writeFileSync(path.join(archive, '.docker.env'), main); fs.writeFileSync(path.join(archive, '.projects.env/.sample.env'), project());
  const run = () => require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '../../dist/cli/main.js'), 'projects-routing', 'application-aliases', 'validate-import', archive, current], {encoding: 'utf8'});
  assert.equal(run().status, 0, 'configuration can be restored before its completed Seed supplies TLS files');
  fs.writeFileSync(path.join(current, '.docker.env'), main);
  assert.notEqual(run().status, 0, 'normal Push requires usable TLS before changing saved state');
  const rendered = require('node:child_process').spawnSync(process.execPath, [path.join(__dirname, '../../dist/cli/main.js'), 'projects-routing', 'application-aliases', 'render', path.join(archive, '.docker.env'), path.join(archive, '.projects.env')], {encoding: 'utf8'});
  assert.notEqual(rendered.status, 0, 'startup cannot serve aliases until matching certificates are available');
});
