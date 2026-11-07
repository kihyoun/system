'use strict';
// Exercise the pinned Wizard's real configuration model without starting its UI.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../../sync/node_modules/typescript');
const aliases = require('../../nginx/wizard-aliases');
const snapshot = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../project-bootstrap/wizard-source/snapshot.json'), 'utf8'));
const source = name => Buffer.from(snapshot.files.find(file => file.path === name).content, 'base64').toString('utf8');
const cube = fs.readFileSync(path.resolve(__dirname, '../../system/.docker.env.example'), 'utf8').slice(0, 1184);
function moduleFromSource(name, imports = {}) {
  const exports = {};
  const compiled = ts.transpileModule(source(name), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(compiled, {exports, require: name => {
    assert(Object.hasOwn(imports, name), 'Unexpected model dependency: ' + name);
    return imports[name];
  }});
  return exports;
}
const environment = moduleFromSource('src/api/Environment.ts');
const model = moduleFromSource('src/api/MainConfig.tsx', {
  'file-saver': {}, 'jszip': {}, 'mobx': {makeAutoObservable: () => {}, runInAction: operation => operation()},
  './Helper': {__esModule: true, default: {textLogo: cube, quote: environment.shellQuote, unquote: environment.shellValue}},
  './Environment': environment, './WebsiteConfig': {websiteSetupDefaults: {}}
}).default;
const input = cube + '\nWIZARD_ENABLE="true"\nWIZARD_HOST="wizard.example.test"\nWIZARD_DOMAIN_MODE="2"\n' +
  'WIZARD_SSL="/ssl/example/cert.pem"\nWIZARD_SSL_KEY="/ssl/example/key.pem"\n' +
  'WIZARD_ALIASES="example.test old.example.test"\nWIZARD_ALIAS_SSL="/ssl/aliases/cert.pem"\nWIZARD_ALIAS_SSL_KEY="/ssl/aliases/key.pem"\n';
const loaded = new model();
for (const [key, value] of environment.environment(input)) loaded.setProperty(key, value);
const backup = JSON.parse(JSON.stringify({main: loaded.asJson, proxies: []}));
const reopened = new model(backup.main);
const generated = reopened.content;
const expected = aliases.validate(input);
assert.equal(JSON.stringify(aliases.validate(generated)), JSON.stringify(expected));
assert.equal(backup.main.runtimeOptions.WIZARD_ALIASES, 'example.test old.example.test');
reopened.gitlabRunnerScale = 4;
assert.equal(JSON.stringify(aliases.validate(reopened.content)), JSON.stringify(expected), 'ordinary unrelated form edits preserve alias options');
reopened.runtimeOptions.WIZARD_ALIASES = '';
assert.equal(aliases.validate(reopened.content).aliases.length, 0, 'an explicitly cleared alias stays cleared');
assert.equal(generated.slice(0, 1184), cube);
console.log('PASS: pinned Wizard Fetch/Open, JSON Backup/Open, generated ZIP/Push environment and unrelated form edits preserve alias configuration.');
