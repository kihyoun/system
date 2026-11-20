'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const YAML = require('../../operations/node_modules/yaml');
const root = path.resolve(__dirname, '../..');
const text = fs.readFileSync(path.join(root, '.gitlab-ci.yml'));
assert.equal(text[807], 36, 'Cube opening');
assert.equal(crypto.createHash('md5').update(text.subarray(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
const document = YAML.parseDocument(text.toString(), {uniqueKeys: true, version: '1.1', merge: true});
assert.deepEqual(document.errors, [], 'CI YAML must parse without duplicate keys or unsupported tags');
const config = document.toJS({maxAliasCount: 1000});
const jobs = Object.fromEntries(Object.entries(config).filter(([name, job]) => !name.startsWith('.') && job?.script).map(([name, job]) => {
  assert(!job.extends || typeof job.extends === 'string', 'Expand the fixture adapter for multiple extends');
  assert(!job.extends || config[job.extends], 'Unknown inherited job');
  return [name, {...(job.extends ? config[job.extends] : {}), ...job}];
}));

// GitLab changes:regexp uses Ruby anchors. JS $ also accepts final newlines,
// so translating \z to $ would silently put newline paths in the light lane.
// Support the grammar used by this repository and reject additions until their
// native semantics are represented; never silently approximate Ruby syntax.
function rubyRegexp(pattern) {
  assert.equal(typeof pattern, 'string');
  assert(!/\(\?(?![:!=])|\[[:.]|&&|[{}]|\*\+|\+\+|\?\+/.test(pattern), 'Unsupported Ruby regexp construct');
  let output = '', inClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (pattern.startsWith('[\\s\\S]', index)) { output += '[\\s\\S]'; index += 5; continue; }
    if (character === '\\') {
      const escaped = pattern[++index];
      assert(escaped && /[Azrn.\/[\]{}()+*?^$|\\-]/.test(escaped), 'Unsupported Ruby regexp escape');
      if (escaped === 'A' || escaped === 'z') {
        assert(!inClass, 'Absolute anchors inside character classes are unsupported');
        output += escaped === 'A' ? '(?<![\\s\\S])' : '(?![\\s\\S])';
      } else output += '\\' + escaped;
    } else if (character === '[') { assert(!inClass, 'Nested Ruby character class unsupported'); inClass = true; output += character; }
    else if (character === ']') { assert(inClass, 'Unbalanced character class'); inClass = false; output += character; }
    else if (!inClass && character === '^') output += '(?:(?<![\\s\\S])|(?<=\\n))';
    else if (!inClass && character === '$') output += '(?=\\n|(?![\\s\\S]))';
    else if (!inClass && character === '.') output += '[^\\n]';
    else output += character;
  }
  assert(!inClass, 'Unclosed character class');
  return new RegExp(output);
}
assert(rubyRegexp('\\Aguide\\z').test('guide'));
for (const value of ['guide\n', '\nguide', 'guide\r', 'guide\u2028']) assert(!rubyRegexp('\\Aguide\\z').test(value));
assert(rubyRegexp('^guide$').test('before\nguide\nafter'));
assert(!rubyRegexp('^guide$').test('before\rguide\rafter'));
for (const pattern of ['\\Z', '\\K', '(?i)guide', '(?<=x)y', '(a)\\1', '[[:alpha:]]']) assert.throws(() => rubyRegexp(pattern));
function condition(expression, environment) {
  return expression.split('&&').map(term => {
    const regex = /^\s*\$([A-Z_]+) =~ \/(.*)\/\s*$/.exec(term);
    if (regex) { const compiled = rubyRegexp(regex[2]); return () => compiled.test(environment[regex[1]] ?? ''); }
    const match = /^\s*\$([A-Z_]+) == (?:\$([A-Z_]+)|"([^"]*)"|(null))\s*$/.exec(term);
    assert(match, 'Unknown CI condition syntax: ' + term);
    return () => (environment[match[1]] ?? null) === (match[2] ? environment[match[2]] ?? null : match[4] ? null : match[3]);
  }).every(evaluate => evaluate());
}
const baseline = {CI_PIPELINE_SOURCE: 'merge_request_event', CI_DEFAULT_BRANCH: 'master', GITHUB_BACKUP_ENABLED: 'true', CI_COMMIT_REF_PROTECTED: 'false'};
function select(paths, environment = baseline, changesAvailable = true) {
  return Object.entries(jobs).flatMap(([name, job]) => {
    const rule = job.rules.find(item => {
      if (item.if && !condition(item.if, environment)) return false;
      if (!item.changes || !changesAvailable || paths.length > 50000) return true;
      assert.deepEqual(Object.keys(item.changes), ['regexp'], 'Unsupported native change selector');
      assert(item.changes.regexp.length <= 255, 'Rule exceeds native length limit');
      const regex = rubyRegexp(item.changes.regexp);
      return paths.some(file => regex.test(file));
    });
    return rule && rule.when !== 'never' ? [name] : [];
  }).sort();
}
const full = ['prepare:wizard-source', 'test:codeql', 'test:isolated', 'test:candidate-image', 'test:wizard-browser', 'test:platform-candidate', 'test:npm-package', 'build'];
const light = ['check:documentation'], runtime = [...light, ...full], beta = ['deploy:wizard-beta', 'stop:wizard-beta'];
const push = {...baseline, CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'master', CI_COMMIT_REF_PROTECTED: 'true'};
const hub = {...push, DOCKERHUB_PUBLISH_ENABLED: 'true'};
const publication = {...hub, GITHUB_RELEASE_PUBLISH_ENABLED: 'true'};
const renovate = {...publication, CI_PIPELINE_SOURCE: 'schedule', RENOVATE_ENABLED: 'true', WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED: 'true'};
const review = {...baseline, SYSTEM_REVIEW_ENABLED: 'true', CI_PROJECT_ID: '42', CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '42'};
const cases = [];
// Real Git rename/deletion parsing is already covered by check-documentation.js.
// Here both sides are explicit inputs to the actual YAML selection contract.
for (const [name, paths] of [
  ['AGENTS', ['AGENTS.md']], ['root guides', ['README.md', 'Prepare-Host.md']],
  ['guides and images', ['docs/HANDBOOK.md', 'docs/images/new.png']], ['empty MR', []], ['documentation deletion', ['README.md']],
]) cases.push([name, paths, light]);
for (const [name, paths] of [
  ['mixed changes', ['README.md', 'system/start.js']], ['unknown location', ['future-component/new-format.xyz']],
  ['CI configuration', ['.gitlab-ci.yml']], ['CI helper', ['gitlab/check-documentation.js']], ['test guide', ['tests/README.md']],
  ['infrastructure', ['bootstrapper/Dockerfile', 'system/docker-compose.yml']], ['submodule configuration', ['.gitmodules']], ['Wizard tree', ['wizard']],
  ['code within docs', ['docs/execute.sh']], ['newline root path', ['README.md\nsystem/start.js']], ['newline docs path', ['docs/guide\nexecute.md']],
  ['trailing newline', ['README.md\n']], ['case mismatch', ['readme.md']], ['suffixed guide', ['README.md.js']],
  ['Wizard code', ['wizard/src/index.tsx']], ['operations code', ['operations/src/cli.ts']],
  ['rename code to docs', ['runtime.js', 'docs/moved.md']], ['rename docs to code', ['docs/moved.md', 'runtime.js']], ['runtime deletion', ['runtime.js']],
]) cases.push([name, paths, runtime]);
cases.push(
  ['comparison limit', Array(50001).fill('README.md'), runtime],
  ['protected docs push', ['AGENTS.md'], [...light, 'deploy:github'], push],
  ['protected runtime push', ['system/start.js'], [...runtime, ...beta, 'deploy:github'], push],
  ['disabled mirror', ['system/start.js'], [...runtime, ...beta], {...push, GITHUB_BACKUP_ENABLED: 'false'}],
  ['public image push', ['system/start.js'], [...runtime, ...beta, 'deploy:github', 'deploy:dockerhub'], hub],
  ['docs cannot publish images', ['README.md'], [...light, 'deploy:github'], hub],
  ['MR cannot publish', ['system/start.js'], runtime, {...baseline, DOCKERHUB_PUBLISH_ENABLED: 'true', CI_COMMIT_REF_PROTECTED: 'true'}],
  ['retired Review selector', ['wizard/src/index.tsx'], runtime, review],
  ['fork MR cannot deploy Beta', ['wizard/src/index.tsx'], runtime, {...review, CI_MERGE_REQUEST_SOURCE_PROJECT_ID: '43'}],
  ['Review selector cannot alter Beta', ['wizard/src/index.tsx'], [...runtime, ...beta, 'deploy:github'], {...push, SYSTEM_REVIEW_ENABLED: 'true'}],
  ['unprotected push', ['system/start.js'], runtime, {...push, CI_COMMIT_REF_PROTECTED: 'false'}],
  ['unavailable comparison', ['README.md'], [...runtime, ...beta, 'deploy:github'], push, false],
  ['feature push', ['system/start.js'], [], {...push, CI_COMMIT_BRANCH: 'feature'}],
  ['nonversion tag', ['system/start.js'], [], {...push, CI_COMMIT_BRANCH: null, CI_COMMIT_TAG: 'v1'}],
  ['protected release tag', ['README.md'], [...runtime, 'deploy:dockerhub'], {...hub, CI_COMMIT_BRANCH: null, CI_COMMIT_TAG: 'v1.2.3'}],
  ['tag without publishing selector', ['README.md'], runtime, {...push, CI_COMMIT_BRANCH: null, CI_COMMIT_TAG: 'v1.2.3'}],
  ['unprotected release tag', ['system/start.js'], [], {...hub, CI_COMMIT_BRANCH: null, CI_COMMIT_TAG: 'v1.2.3', CI_COMMIT_REF_PROTECTED: 'false'}],
  ['Renovate discovery alone', ['system/start.js'], ['renovate:discover'], renovate, false],
  ['unprotected schedule', ['system/start.js'], [], {...renovate, CI_COMMIT_REF_PROTECTED: 'false'}, false],
  ['MR cannot start bot', ['system/start.js'], runtime, {...baseline, RENOVATE_ENABLED: 'true'}],
  ['accepted public metadata', ['system/start.js'], [...runtime, ...beta, 'deploy:github', 'deploy:dockerhub', 'deploy:github-release'], publication],
  ['npm accepted release', ['operations/src/cli.ts'], [...runtime, ...beta, 'deploy:github', 'deploy:dockerhub', 'deploy:github-release', 'deploy:npm'], {...publication, NPM_PUBLISH_ENABLED: 'true'}],
  ['MR cannot publish npm', ['operations/src/cli.ts'], runtime, {...baseline, NPM_PUBLISH_ENABLED: 'true', GITHUB_RELEASE_PUBLISH_ENABLED: 'true'}],
);
for (const source of ['web', 'api', 'trigger', 'pipeline', 'schedule']) cases.push([source + ' retains runtime gates', ['README.md'], runtime, {...push, CI_PIPELINE_SOURCE: source}, false]);
for (const [name, paths, expected, environment, available] of cases) assert.deepEqual(select(paths, environment, available), [...expected].sort(), name);

for (const name of full) {
  const job = jobs[name];
  assert.notEqual(job.allow_failure, true, name + ' must remain required');
  assert(!job.rules.some(rule => rule.when === 'manual'), name + ' must run automatically');
  assert((job.dependencies || []).every(dependency => full.includes(dependency)), name + ' artifact selection closure');
}
const equal = (name, fields) => { for (const [field, expected] of Object.entries(fields)) assert.deepEqual(jobs[name][field], expected, name + '.' + field); };
const native = ['node bootstrapper/ca/check.js --bundle', 'npm --prefix operations ci --ignore-scripts --no-audit --no-fund', 'npm --prefix operations run build', 'timeout -k 5 110 node operations/dist/host-bootstrap/entry.js install-runtime --checkout "$CI_PROJECT_DIR"'];
const isolated = {services: [], tags: ['docker']};
equal('check:documentation', {...isolated, script: ['node operations/dist/ci/entry.js documentation "$CI_PROJECT_DIR"'], after_script: ['node operations/dist/ci/entry.js documentation "$CI_PROJECT_DIR" cleanup'], timeout: '3m', allow_failure: false, needs: undefined, dependencies: undefined});
assert.equal(jobs['check:documentation'].variables.RUNNER_SCRIPT_TIMEOUT, '2m');
assert.equal(jobs['check:documentation'].variables.RUNNER_AFTER_SCRIPT_TIMEOUT, '30s');
assert(!Object.keys(jobs).some(name => name.includes('wizard-review')), 'System Review jobs must not return');
for (const name of beta) {
  equal(name, {...isolated, allow_failure: true, resource_group: 'wizard-beta', stage: 'deploy', before_script: native, timeout: '14m', needs: undefined});
  assert.equal(jobs[name].variables.RUNNER_SCRIPT_TIMEOUT, '12m');
  assert.equal(jobs[name].rules[0].when, 'manual');
  assert.deepEqual(jobs[name].rules.at(-1), {when: 'never'});
  assert.equal(jobs[name].artifacts.reports.dotenv, 'test-results/system-beta/environment.env');
}
equal('deploy:wizard-beta', {dependencies: ['test:platform-candidate']});
equal('stop:wizard-beta', {dependencies: []});
assert.equal(jobs['deploy:wizard-beta'].environment.on_stop, 'stop:wizard-beta');
assert.equal(jobs['stop:wizard-beta'].environment.action, 'stop');
const projectCI = fs.readFileSync(path.join(root, 'project-bootstrap/wizard-environments/recipe.js'), 'utf8');
assert(projectCI.includes("['review', 'beta']") && projectCI.includes('review/$CI_PROJECT_ID/mr-$CI_MERGE_REQUEST_IID'), 'Generic project Review and Beta remain available');
equal('deploy:npm', {dependencies: ['test:npm-package', 'test:platform-candidate', 'deploy:dockerhub', 'deploy:github', 'deploy:github-release'], needs: undefined, allow_failure: false, interruptible: false, resource_group: 'npm-release'});
for (const name of ['deploy:npm', 'deploy:dockerhub']) {
  assert.deepEqual(jobs[name].rules.at(-1), {when: 'never'});
  for (const rule of jobs[name].rules.slice(0, -1)) for (const selector of ['$CI_COMMIT_REF_PROTECTED == "true"', '$CI_PIPELINE_SOURCE == "push"', name === 'deploy:npm' ? '$NPM_PUBLISH_ENABLED == "true"' : '$DOCKERHUB_PUBLISH_ENABLED == "true"']) assert(rule.if.includes(selector), name + ' protected publisher selectors');
}
equal('deploy:github', {dependencies: [], script: ['node operations/dist/mirror/entry.js ci']});
assert.deepEqual(jobs['deploy:github'].artifacts.paths, ['test-results/github/']);
assert.equal(jobs['deploy:github'].artifacts.when, 'always');
assert.equal(jobs['deploy:github'].rules[0].if, '$GITHUB_BACKUP_ENABLED == "true" && $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_COMMIT_REF_PROTECTED == "true" && $CI_COMMIT_TAG == null');
equal('test:wizard-browser', {...isolated, script: ['node operations/dist/ci/entry.js wizard-browser "$CI_PROJECT_DIR"'], after_script: ['node operations/dist/ci/entry.js wizard-browser "$CI_PROJECT_DIR" cleanup']});
assert.equal(jobs['test:wizard-browser'].artifacts.reports.junit, 'test-results/wizard-browser/junit.xml');
equal('deploy:dockerhub', {...isolated, script: ['node gitlab/publish-dockerhub.js'], dependencies: ['test:platform-candidate'], needs: undefined, stage: 'deploy', allow_failure: false, interruptible: false, resource_group: 'dockerhub-release-$CI_PROJECT_ID'});
assert.equal(jobs['deploy:dockerhub'].variables.GIT_DEPTH, '0');
assert.deepEqual(jobs['deploy:dockerhub'].artifacts.paths, ['test-results/dockerhub/']);
equal('build', {script: ['echo "$CI_REGISTRY_PASSWORD" | docker login --username $CI_REGISTRY_USER --password-stdin $CI_REGISTRY', 'docker build --provenance=false --sbom=false -f bootstrapper/Dockerfile -t $IMAGE_TAG .', 'docker push $IMAGE_TAG'], before_script: native});
assert.equal(config.variables.IMAGE_TAG, '$CI_REGISTRY_IMAGE:$CI_COMMIT_REF_SLUG');
assert.match(config.image, /^node:24\.22\.0-alpine3\.24@sha256:[a-f0-9]{64}$/);
assert.match(config.services[0], /^docker:29\.9\.2-dind@sha256:[a-f0-9]{64}$/);
assert.deepEqual(config.default.before_script, ['node bootstrapper/ca/check.js --bundle']);
assert.equal(config.variables.NODE_OPTIONS, '--use-openssl-ca');
console.log(`PASS: ${cases.length} native YAML path/event cases, Ruby absolute/line anchors, required gates, artifact closure, protected releases and mirror`);
