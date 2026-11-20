import JSZip from 'jszip';
import {execFileSync} from 'child_process';
import md5 from 'md5';
import Main from './Main';
import MainConfig from './MainConfig';
import Helper from './Helper';
import {environment, shellQuote, shellValue} from './Environment';
import {websiteSetupDefaults} from './WebsiteConfig';

const signed = (body: string) => Helper.textLogo + body;
const assertSignature = (data: string) => {
  expect(data[807]).toBe('$');
  expect(md5(data.slice(0, 1184))).toBe('bd4a8426355824593a5e21ad759830c1');
};
const assignments = (data: string) => Object.fromEntries(environment(data).map(([key, value]) => [key, shellValue(value)]));

test.each([
  ['', ''],
  ["'a=b=c'", 'a=b=c'],
  ['"a=b=c" # comment', 'a=b=c'],
  ["'a'\\''b'", "a'b"],
  ['unquoted\\ space', 'unquoted space'],
  // eslint-disable-next-line no-useless-escape -- Explicit shell quote fixture.
  ['"a\\$b\\`c\\\\d\\\"e"', 'a$b`c\\d"e'],
  ['"a\\q"', 'a\\q'],
  ['"first\nsecond"', 'first\nsecond']
])('literal shell values decode without truncation: %s', (input, value) => {
  expect(shellValue(input)).toBe(value);
  expect(shellValue(shellQuote(value))).toBe(value);
});

test.each(['"unterminated', '$(touch /tmp/example)', '"$HOME"', '`id`', 'value; echo broken', 'value echo broken'])('unsupported shell expression fails before import: %s', value => {
  const main = new Main();
  const before = JSON.stringify(main.asJson);
  expect(() => main.importEnvData(signed(`SEED_DIR='/changed'\nSYNC_PASS=${value}\n`))).toThrow();
  expect(JSON.stringify(main.asJson)).toBe(before);
});

test('the observed single-quoted config preserves counts, modes, URLs, TLS and runtime image pins', () => {
  const main = new Main();
  const input = signed(`export SEED_DIR='/mnt/seed'
GITLAB_EXTERNAL_URL='https://gitlab.example.test:8443/path?a=b=c'
GITLAB_REGISTRY_URL='https://registry.example.test:5443'
GITLAB_HOST='gitlab.example.test'
GITLAB_DOMAIN_MODE='2'
GITLAB_SSL='/ssl/custom/fullchain.pem'
GITLAB_SSL_KEY='/ssl/custom/privkey.pem'
GITLAB_REGISTRY_HOST='registry.example.test'
GITLAB_REGISTRY_DOMAIN_MODE='3'
GITLAB_REGISTRY_SSL='/ssl/registry/fullchain.pem'
GITLAB_REGISTRY_SSL_KEY='/ssl/registry/privkey.pem'
GITLAB_RUNNER_TOKEN='test-token=a=b'
export GITLAB_RUNNER_SCALE='1'
export SYNC_ENABLE='true'
SYNC_HOST='sync.example.test'
SYNC_USER='test-user'
SYNC_PASS='test-password=a=b'
SYNC_DOMAIN_MODE='2'
SYNC_SSL='/ssl/sync/fullchain.pem'
SYNC_SSL_KEY='/ssl/sync/privkey.pem'
WIZARD_ENABLE='true'
WIZARD_HOST='wizard.example.test'
WIZARD_DOMAIN_MODE='2'
WIZARD_SSL='/ssl/wizard/fullchain.pem'
WIZARD_SSL_KEY='/ssl/wizard/privkey.pem'
GITLAB_IMAGE='gitlab/gitlab-ce:19.4.2-ce.0'
GITLAB_RUNNER_IMAGE='gitlab/gitlab-runner:v19.4.0'
GITLAB_SSH_BIND='127.0.0.1:2222'
GITLAB_REGISTRY_BIND='127.0.0.1:5050'
FUTURE_RUNTIME_OPTION='preserve=unknown'
`);
  main.importEnvData(input);
  expect(main.config!.gitlabRunnerScale).toBe(1);
  expect(main.config!.gitlabDomainMode).toBe(2);
  expect(main.config!.gitlabRegistryDomainMode).toBe(3);
  expect(main.config!.syncDomainMode).toBe(2);
  expect(main.config!.wizardDomainMode).toBe(2);
  const jsonCopy = new MainConfig(JSON.parse(JSON.stringify(main.asJson.main)));
  expect(assignments(jsonCopy.content)).toEqual({...websiteSetupDefaults, ...assignments(input)});
  assertSignature(main.config!.content);
  assertSignature(jsonCopy.content);
});

test('raw credentials are safely quoted exactly once and survive JSON and ENV', () => {
  const config = new MainConfig({syncEnable: 'true', gitlabRunnerScale: 0});
  // eslint-disable-next-line no-useless-escape -- Explicit shell quote fixture.
  const credential = ` quote'\" equals=a=b dollar$HOME backtick\` slash\\ end `;
  config.syncPass = credential;
  config.gitlabRunnerToken = credential;
  const main = new Main();
  main.importEnvData(config.content);
  expect(main.config!.syncPass).toBe(credential);
  expect(main.config!.gitlabRunnerToken).toBe(credential);
  const restored = new MainConfig(JSON.parse(JSON.stringify(main.asJson.main)));
  expect(restored.syncPass).toBe(credential);
  expect(restored.gitlabRunnerScale).toBe(0);
});

test('project receipt, unknown options, explicit mode zero and runner token survive backup', () => {
  const main = new Main();
  main.importProjectEnvData(signed(`PROJECT_NAME='sample'
PROJECT_TEMPLATE='empty'
USE_PROD_HOST='true'
PROD_HOST='sample.test'
PROD_DOMAIN_MODE='0'
USE_BETA_HOST='false'
USE_REVIEW_HOST='true'
REVIEW_HOST='review.sample.test'
REVIEW_DOMAIN_MODE='0'
GITLAB_RUNNER_TOKEN='test=a=b'
GITLAB_RUNNER_SCALE='2'
FUTURE_PROJECT_OPTION='test=value'
# BOOTSTRAPPER_PROJECT=eyJkZWZhdWx0UHJvamVjdCI6dHJ1ZX0=
`));
  const restored = new Main();
  restored.importJson(new File([], 'bootstrapper.json'), JSON.stringify(main.asJson));
  const project = restored.projects.get('sample')!;
  expect(project.gitlabRunnerToken).toBe('test=a=b');
  expect(project.gitlabRunnerScale).toBe(2);
  expect(project.reviewDomainMode).toBe(0);
  expect(project.runtimeOptions.FUTURE_PROJECT_OPTION).toBe('test=value');
  expect(project.content).toContain('# BOOTSTRAPPER_PROJECT=eyJkZWZhdWx0UHJvamVjdCI6dHJ1ZX0=');
  assertSignature(project.content);
});

test('ZIP exports the same recoverable JSON, main ENV and project ENV', async () => {
  const main = new Main();
  main.importEnvData(signed("SEED_DIR='/mnt/seed'\nGITLAB_IMAGE='gitlab/gitlab-ce:19.4.2-ce.0'\nGITLAB_RUNNER_SCALE='1'\n"));
  main.importProjectEnvData(signed("PROJECT_NAME='sample'\nGITLAB_RUNNER_TOKEN='test=a=b'\n"));
  const zip = await JSZip.loadAsync(await main.generateZip());
  const config = JSON.parse(await zip.file('bootstrapper.json')!.async('string'));
  const env = await zip.file('.docker.env')!.async('string');
  const project = await zip.file('.projects.env/.sample.env')!.async('string');
  expect(config.main.runtimeOptions.GITLAB_IMAGE).toBe('gitlab/gitlab-ce:19.4.2-ce.0');
  expect(config.main.gitlabRunnerScale).toBe(1);
  expect(assignments(env).GITLAB_IMAGE).toBe(config.main.runtimeOptions.GITLAB_IMAGE);
  expect(assignments(project).GITLAB_RUNNER_TOKEN).toBe('test=a=b');
  assertSignature(env);
  assertSignature(project);
});

test('Cube validation remains strict for main and project imports', () => {
  const altered = signed("GITLAB_RUNNER_SCALE='1'\n").replace('https://www.system-bootstrapper.com', 'http://www.system-bootstrapper.com');
  const main = new Main();
  expect(() => main.importEnvData(altered)).toThrow('Invalid Configuration');
  expect(() => main.importProjectEnvData(altered)).toThrow('Invalid Configuration');
});


test('multiline literal values remain valid shell assignments through Fetch and Backup', () => {
  const config = new MainConfig({syncEnable: 'true'});
  config.syncPass = 'first line\nsecond=line\nthird';
  const main = new Main();
  main.importEnvData(config.content);
  expect(main.config!.syncPass).toBe(config.syncPass);
  expect(environment('VALUE=one # a comment with an unmatched "\nNEXT=two\n').length).toBe(2);
});


test('generated shell values match actual Bash semantics without executing credentials', () => {
  for (const value of ['', ' a=b ', 'first\nsecond', `apostrophe' quote" slash\\ dollar$HOME literal$(id) backtick\`id\``]) {
    const output = execFileSync('bash', ['-s'], {input: `VALUE=${shellQuote(value)}\nprintf '%s' "$VALUE"\n`, encoding: 'utf8'});
    expect(output).toBe(value);
    expect(shellValue(shellQuote(value))).toBe(output);
  }
});


test('explicit empty credentials and project tokens are retained instead of invented defaults', () => {
  const main = new Main();
  main.importEnvData(signed(`SYNC_ENABLE='true'\nSYNC_USER=''\nSYNC_PASS=''\n`));
  main.importProjectEnvData(signed(`PROJECT_NAME='emptytoken'\nGITLAB_RUNNER_TOKEN=''\n`));
  const restored = new Main();
  restored.importJson(new File([], 'bootstrapper.json'), JSON.stringify(main.asJson));
  expect(restored.config!.syncUser).toBe('');
  expect(restored.config!.syncPass).toBe('');
  expect(restored.projects.get('emptytoken')!.gitlabRunnerToken).toBe('');
});

test('recovery evidence distinguishes saved settings from timestamped running images and never pairs a Seed', async () => {
  const main = new Main();
  const saved = 'example/wizard@sha256:' + 'a'.repeat(64);
  main.importEnvData(signed(`WIZARD_IMAGE='${saved}'\nGITLAB_RUNNER_SCALE='0'\nFUTURE_OPTION='preserved'\n`));
  const observation = {format: 'system-runtime-observation-v1', status: 'partial', observedAt: '2026-01-01T00:00:00.000Z',
    system: {sourceRevision: 'b'.repeat(40), release: null}, wizard: null,
    images: {wizard: {reference: 'different/wizard@sha256:' + 'c'.repeat(64), imageId: 'sha256:' + 'd'.repeat(64)}}};
  main.recoveryObservation = observation;
  const zip = await JSZip.loadAsync(await main.generateZip());
  const exported = JSON.parse(await zip.file('bootstrapper.json')!.async('string'));
  const recovery = JSON.parse(await zip.file('recovery.json')!.async('string'));
  expect(exported.recovery).toEqual(recovery);
  expect(recovery.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(recovery.savedImages.wizard.reference).toBe(saved);
  expect(recovery.savedImages.controller).toEqual({setting: 'BOOTSTRAPPER_IMAGE', reference: null, status: 'unspecified'});
  expect(recovery.observedRuntime).toEqual(observation);
  expect(recovery.seed).toMatchObject({status: 'matching-completed-seed-required', generation: null, manifest: null, verified: false});
  const guide = await zip.file('RECOVERY.md')!.async('string');
  expect(guide).toContain('bootstrapper/seed-operation.sh restore');
  expect(guide).toContain('A reference does not preserve an image payload');
  expect(guide).toContain('No matching Seed has been inferred or verified');
  const reopened = new Main();
  exported.recovery.savedImages.wizard.reference = 'untrusted/metadata:latest';
  exported.recovery.seed = {verified: true, generation: 'invented'};
  reopened.importJson(new File([], 'bootstrapper.json'), JSON.stringify(exported));
  expect(assignments(reopened.config!.content).WIZARD_IMAGE).toBe(saved);
  expect(assignments(reopened.config!.content).FUTURE_OPTION).toBe('preserved');
  expect(reopened.asJson.recovery.observedRuntime.status).toBe('unavailable');
  expect(reopened.asJson.recovery.importedBackup.status).toBe('imported-unverified');
  expect(reopened.asJson.recovery.importedBackup.observedRuntime).toEqual(observation);
  expect(reopened.asJson.recovery.importedBackup.seed).toBeUndefined();
  expect(reopened.asJson.recovery.seed.verified).toBe(false);
  assertSignature(reopened.config!.content);
});

test('old JSON backups and metadata-free offline imports remain usable with honestly unknown runtime', () => {
  const main = new Main();
  const old = {main: {gitlabRunnerScale: 0, runtimeOptions: {GITLAB_SSH_BIND: '127.0.0.1:2222'}}, proxies: []};
  main.importJson(new File([], 'old.json'), JSON.stringify(old));
  expect(main.config!.gitlabRunnerScale).toBe(0);
  expect(assignments(main.config!.content).GITLAB_SSH_BIND).toBe('127.0.0.1:2222');
  expect(main.asJson.recovery.observedRuntime).toMatchObject({status: 'unavailable', observedAt: null, system: null, wizard: null});
  main.recoveryObservation = {format: 'system-runtime-observation-v1', status: 'partial'};
  main.importEnvData(signed("GITLAB_RUNNER_SCALE='0'\n"));
  expect(main.asJson.recovery.observedRuntime.status).toBe('unavailable');
});

test('saved empty image selection remains distinct from an absent setting', () => {
  const main = new Main();
  main.importEnvData(signed("BOOTSTRAPPER_IMAGE=''\nGITLAB_RUNNER_SCALE='0'\n"));
  expect(main.asJson.recovery.savedImages.controller).toEqual({setting: 'BOOTSTRAPPER_IMAGE', reference: '', status: 'empty'});
  expect(main.asJson.recovery.savedImages.wizard.status).toBe('unspecified');
});

test('imported descriptive history is bounded and cannot grow recursively or authorize a Seed', () => {
  const main = new Main();
  const original = JSON.parse(JSON.stringify(main.asJson));
  original.recovery.importedBackup = {arbitrary: 'older record'};
  original.recovery.seed = {verified: true, generation: 'unverified-claim'};
  main.importJson(new File([], 'bootstrapper.json'), JSON.stringify(original));
  expect(main.asJson.recovery.importedBackup.importedBackup).toBeUndefined();
  expect(main.asJson.recovery.importedBackup.seed).toBeUndefined();
  original.recovery.observedRuntime = {format: 'system-runtime-observation-v1', payload: 'x'.repeat(1024 * 1024)};
  main.importJson(new File([], 'bootstrapper.json'), JSON.stringify(original));
  expect(main.asJson.recovery.importedBackup).toBeNull();
  expect(main.asJson.recovery.observedRuntime.status).toBe('unavailable');
  expect(main.asJson.recovery.seed.verified).toBe(false);
});
