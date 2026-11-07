'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const aliases = require('../../nginx/wizard-aliases');
const cube = fs.readFileSync(path.resolve(__dirname, '../../system/.docker.env.example'), 'utf8').slice(0, 1184);
const main = {
  WIZARD_ENABLE: 'true', WIZARD_HOST: 'wizard.example.test', WIZARD_DOMAIN_MODE: '2',
  WIZARD_ALIASES: 'example.test old.example.test', WIZARD_SSL: '/ssl/live/example/fullchain.pem',
  WIZARD_SSL_KEY: '/ssl/live/example/privkey.pem',
  GITLAB_HOST: 'gitlab.example.test', GITLAB_DOMAIN_MODE: '2',
  GITLAB_REGISTRY_HOST: 'registry.example.test', GITLAB_REGISTRY_DOMAIN_MODE: '2',
  SYNC_HOST: 'sync.example.test', SYNC_DOMAIN_MODE: '2'
};
const env = values => cube + Object.entries(values).map(([key, value]) => key + '="' + value.replace(/[\\"$`]/g, '\\$&') + '"').join('\n') + '\n';
const selected = changes => aliases.validate(env({...main, ...changes}));

test('both protocols use the configured canonical origin, preserve request URI and exempt HTTP01', () => {
  const config = selected({WIZARD_HOST: 'Wizard.Example.Test', WIZARD_ALIASES: 'EXAMPLE.test old.example.test'});
  assert.deepEqual(config.aliases, ['example.test', 'old.example.test']);
  assert.equal(config.origin, 'https://wizard.example.test');
  assert.equal(config.certificate, main.WIZARD_SSL);
  const rendered = aliases.render(config);
  assert.equal((rendered.match(/return 308 https:\/\/wizard\.example\.test\$request_uri;/g) || []).length, 2);
  assert.equal((rendered.match(/location \^~ \/\.well-known\/acme-challenge\//g) || []).length, 2);
  assert.match(rendered, /listen 80;/);
  assert.match(rendered, /listen 443 ssl;/);
  assert.doesNotMatch(rendered, /proxy_pass|system-bootstrapper\.com/);
  assert.equal(selected({WIZARD_DOMAIN_MODE: '0'}).origin, 'http://wizard.example.test');
  assert.equal(selected({WIZARD_ALIAS_SSL: '/ssl/custom/cert.pem', WIZARD_ALIAS_SSL_KEY: '/ssl/custom/key.pem'}).certificate, '/ssl/custom/cert.pem');
});

test('host, canonical loop, mode and certificate validation fails closed', () => {
  for (const host of ['https://example.test', 'example.test:443', '*.example.test', '.example.test', 'example.test.',
    '127.0.0.1', '[::1]', 'bad_.example.test', '-bad.example.test', 'bad-.example.test', 'a'.repeat(64) + '.test',
    'example.test;return', '$host', 'example.test/example']) {
    assert.throws(() => selected({WIZARD_ALIASES: host}), undefined, host);
  }
  for (const changes of [{WIZARD_ALIASES: 'wizard.example.test'}, {WIZARD_ALIASES: 'example.test EXAMPLE.TEST'},
    {WIZARD_ENABLE: 'false'}, {WIZARD_DOMAIN_MODE: '1'}, {WIZARD_DOMAIN_MODE: '3'},
    {WIZARD_HOST: '*.example.test'}, {WIZARD_SSL: ''}, {WIZARD_ALIAS_SSL: '/ssl/../outside.pem'},
    {WIZARD_ALIAS_SSL: '/etc/private.pem'}, {WIZARD_ALIAS_SSL: '/ssl/cert.pem;return'},
    {WIZARD_ALIAS_SSL: main.WIZARD_SSL_KEY}]) assert.throws(() => selected(changes));
});

test('explicit platform hosts and applicable wildcard domains are reserved', () => {
  for (const prefix of ['GITLAB', 'GITLAB_REGISTRY', 'SYNC']) {
    assert.throws(() => selected({[prefix + '_HOST']: 'EXAMPLE.TEST'}), /platform host/);
    for (const mode of ['1', '3']) assert.throws(() => selected({[prefix + '_HOST']: 'example.test', [prefix + '_DOMAIN_MODE']: mode}), /platform host/);
    assert.throws(() => selected({[prefix + '_HOST']: '*.example.test', [prefix + '_DOMAIN_MODE']: '0'}), /platform host/);
  }
  assert.equal(selected({GITLAB_HOST: 'unrelated.test', GITLAB_DOMAIN_MODE: '3'}).aliases.length, 2);
  assert.equal(selected({WIZARD_ALIASES: 'example.test', GITLAB_HOST: 'example.test', GITLAB_DOMAIN_MODE: '3'}).aliases.length, 1,
    'NGINX *.example.test does not reserve its apex');
});

test('all enabled application and managed Wizard environments reserve exact and wildcard hosts', () => {
  for (const prefix of ['PROD', 'BETA', 'REVIEW']) {
    const project = {["USE_" + prefix + '_HOST']: 'true', [prefix + '_HOST']: 'old.example.test', [prefix + '_DOMAIN_MODE']: '2'};
    assert.throws(() => aliases.validate(env(main), [env(project)]), /project host/);
    for (const mode of ['1', '3']) assert.throws(() => aliases.validate(env(main),
      [env({...project, [prefix + '_HOST']: 'example.test', [prefix + '_DOMAIN_MODE']: mode})]), /project host/);
    assert.equal(aliases.validate(env(main), [env({...project, ['USE_' + prefix + '_HOST']: 'false'})]).aliases.length, 2);
  }
});

test('canonical hostname changes can turn the managed Wizard previous Production host into an alias', () => {
  const managed = env({PROJECT_NAME: 'wizard', PROJECT_TEMPLATE: 'wizard', USE_PROD_HOST: 'true',
    PROD_HOST: 'old.example.test', PROD_DOMAIN_MODE: '2', USE_BETA_HOST: 'false', USE_REVIEW_HOST: 'false'});
  assert.equal(aliases.validate(env(main), [managed]).aliases.length, 2);
  const beta = managed.replace('USE_BETA_HOST="false"', 'USE_BETA_HOST="true"') + 'BETA_HOST="old.example.test"\nBETA_DOMAIN_MODE="2"\n';
  assert.throws(() => aliases.validate(env(main), [beta]), /project host/);
});

test('deployments with no alias retain their chosen host and mode contracts', () => {
  for (const value of ['', '  \n\t']) {
    const config = aliases.validate(env({WIZARD_ALIASES: value, WIZARD_HOST: 'localhost:8080', WIZARD_DOMAIN_MODE: '1'}));
    assert.deepEqual(config, {aliases: []});
    assert.equal(aliases.render(config), '');
  }
  assert.deepEqual(aliases.validate('GITLAB_HOST=localhost\n'), {aliases: []});
  assert.deepEqual(aliases.validate('WIZARD_SSL="$SSL_DIRECTORY/cert.pem"\nPRIVATE="$PRIVATE_VALUE"\n'), {aliases: []});
});

test('configuration update preserves every unrelated byte and the exact Cube', () => {
  const source = env({...main, WIZARD_ALIASES: ''}) + '# private value deliberately spans routing-looking lines\n' +
    'export PRIVATE="first\nWIZARD_ALIASES=not-an-assignment\nlast"\nexport KEEP="literal \\$HOME"\n';
  const next = aliases.configure(source, ['EXAMPLE.test'], '/ssl/custom/cert.pem', '/ssl/custom/key.pem');
  aliases.signature(next);
  assert.equal(next.slice(0, 1184), cube);
  const strip = text => aliases.records(text).filter(record => aliases.aliasKeys.includes(record.key)).reverse()
    .reduce((current, record) => current.slice(0, record.start) + current.slice(record.end), text);
  assert.equal(strip(next), strip(source));
  assert.deepEqual(aliases.validate(next).aliases, ['example.test']);
  assert.deepEqual(aliases.validate(aliases.configure(next, [])).aliases, []);
  assert.throws(() => aliases.configure(source.replace('#$', '#!'), ['example.test']), /Cube/);
  assert.throws(() => aliases.configure(source, ['example.test\nmalformed']));
  assert.throws(() => aliases.validate(env(main) + 'WIZARD_ALIASES="duplicate.test"\n'), /Duplicate/);
  assert.throws(() => aliases.validate(env(main) + 'WIZARD_ALIAS_SSL="$HOME/file"\n'), /expansion/);
});

test('CLI writes only a new private file and refuses conflicts before writing', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-alias-config-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const source = path.join(root, '.docker.env'), output = path.join(root, 'next.env');
  fs.writeFileSync(source, env({...main, WIZARD_ALIASES: ''}));
  const tool = path.resolve(__dirname, '../../nginx/wizard-aliases.js');
  const run = (...args) => spawnSync(process.execPath, [tool, 'configure', '--config', source, '--output', output, ...args], {encoding: 'utf8'});
  const before = fs.readFileSync(source, 'utf8');
  assert.notEqual(run('--alias', 'gitlab.example.test').status, 0);
  assert.equal(fs.existsSync(output), false);
  const result = run('--alias', 'example.test');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(source, 'utf8'), before);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.deepEqual(aliases.validate(fs.readFileSync(output, 'utf8')).aliases, ['example.test']);
  assert.doesNotMatch(result.stdout + result.stderr, /SYNC_HOST|fullchain\.pem|export /);
  assert.notEqual(run('--alias', 'other.test').status, 0, 'existing output must never be overwritten');
});

test('ZIP validation accounts for replaced projects and preserved server-owned Wizard environments', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-alias-import-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const archive = path.join(root, 'archive'), current = path.join(root, 'current');
  for (const directory of [archive, current]) fs.mkdirSync(path.join(directory, '.projects.env'), {recursive: true});
  fs.writeFileSync(path.join(archive, '.docker.env'), env(main));
  const project = env({USE_BETA_HOST: 'true', BETA_HOST: 'old.example.test', BETA_DOMAIN_MODE: '2'});
  fs.writeFileSync(path.join(current, '.projects.env/.old.env'), project);
  assert.equal(aliases.validateImport(archive, current).aliases.length, 2, 'replaced ordinary projects do not reserve stale hosts');
  const receipt = '# BOOTSTRAPPER_PROJECT=' + Buffer.from(JSON.stringify({defaultProject: true, template: 'wizard'})).toString('base64') + '\n';
  fs.writeFileSync(path.join(current, '.projects.env/.wizard.env'), project + receipt);
  assert.throws(() => aliases.validateImport(archive, current), /project host/);
});
