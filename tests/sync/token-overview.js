'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {credentialExpiry, tokenMonitorSettings, tokenEnvironmentSettings, safeTokenOverview} = require('../../sync/dist/TokenOverview');
const now = Date.parse('2026-11-09T12:00:00Z');
assert.equal(credentialExpiry('2026-11-09', false, 14, now).status, 'expired');
assert.equal(credentialExpiry('2026-11-10', false, 14, now).status, 'expiring');
assert.equal(credentialExpiry('2026-11-23', false, 14, now).status, 'expiring');
assert.equal(credentialExpiry('2026-11-24', false, 14, now).status, 'valid');
assert.equal(credentialExpiry('2026-02-30', false, 14, now).status, 'unknown');
assert.equal(credentialExpiry(null, false, 14, now).status, 'unknown');
assert.equal(credentialExpiry('2030-01-01', true, 14, now).status, 'revoked');
const settings = tokenMonitorSettings({SYSTEM_CREDENTIAL_PROJECT_PATHS: '["example/system"]',
  SYSTEM_CREDENTIAL_EXPIRY_METADATA: '[{"projectPath":"example/system","key":"GITHUB_RELEASE_TOKEN","expiresAt":"2026-11-12"}]'});
const encoded = 'export SYSTEM_CREDENTIAL_PROJECT_PATHS="[\\"example/system\\"]"\n' +
  'export SYSTEM_CREDENTIAL_EXPIRY_METADATA="[{\\"projectPath\\":\\"example/system\\",\\"key\\":\\"GITHUB_RELEASE_TOKEN\\",\\"expiresAt\\":\\"2026-11-12\\"}]"\n';
assert.deepEqual(tokenEnvironmentSettings(encoded), settings, 'escaped JSON from the Wizard ENV serializer must be decoded literally');
const serializer = require('../../project-bootstrap/wizard-source/snapshot.json').files.find(file => file.path === 'src/api/Environment.ts');
assert(serializer, 'the pinned Wizard snapshot must include its actual ENV serializer');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'token-env-roundtrip-'));
try {
  const file = path.join(temporary, 'Environment.mts');
  fs.writeFileSync(file, Buffer.from(serializer.content, 'base64'));
  const {extraEnvironment} = require(file);
  assert.deepEqual(tokenEnvironmentSettings(extraEnvironment({
    SYSTEM_CREDENTIAL_PROJECT_PATHS: JSON.stringify(settings.projects),
    SYSTEM_CREDENTIAL_EXPIRY_METADATA: JSON.stringify(settings.metadata)
  })), settings, 'actual pinned Wizard ENV output must survive server monitoring input');
} finally { fs.rmSync(temporary, {recursive:true, force:true}); }
assert.deepEqual(tokenEnvironmentSettings('export PRIVATE_TEXT="first line\nSYSTEM_CREDENTIAL_PROJECT_PATHS=invalid\nlast line"\n' + encoded), settings, 'assignments inside multiline values are not settings');
assert.throws(() => tokenEnvironmentSettings('export SYSTEM_CREDENTIAL_PROJECT_PATHS="$(touch /never-execute)"\n'));
const result = safeTokenOverview({credentials: [
  {projectPath: 'example/system', key: 'RENOVATE_TOKEN', configured: true, expiresAt: '2026-11-10', expirySource: 'gitlab', token: 'never-disclose', value: 'never-disclose'},
  {projectPath: 'example/system', key: 'SYSTEM_RELEASE_GITLAB_TOKEN', configured: true, expiresAt: '2027-01-01', revoked: true, expirySource: 'gitlab'},
  {projectPath: 'example/system', key: 'DOCKERHUB_TOKEN', configured: true, expiresAt: '2029-01-01', expirySource: 'untrusted'},
  {projectPath: 'foreign/project', key: 'RENOVATE_TOKEN', expiresAt: '2030-01-01', expirySource: 'gitlab'}
]}, settings, now);
assert.equal(result.credentials.length, 4);
assert.equal(result.credentials[0].status, 'expiring');
assert.equal(result.credentials[1].status, 'revoked');
assert.equal(result.credentials[2].expirySource, 'operator-recorded');
assert.equal(result.credentials[3].status, 'unknown');
assert.equal(result.permissionCheck, false);
assert(!JSON.stringify(result).includes('never-disclose'));
assert(!JSON.stringify(result).includes('foreign/project'));
assert.equal(safeTokenOverview({}, tokenMonitorSettings({}), now).credentials.length, 0);
for (const invalid of ['["../project"]', '["https://example.com/repo"]', '["a/b","a/b"]', 'null', 'invalid']) {
  assert.throws(() => tokenMonitorSettings({SYSTEM_CREDENTIAL_PROJECT_PATHS: invalid}));
}
assert.throws(() => tokenMonitorSettings({SYSTEM_CREDENTIAL_WARNING_DAYS: '0'}));
assert.throws(() => tokenMonitorSettings({SYSTEM_CREDENTIAL_PROJECT_PATHS: '["a/b"]',
  SYSTEM_CREDENTIAL_EXPIRY_METADATA: '[{"projectPath":"a/b","key":"RENOVATE_TOKEN","expiresAt":"2027-01-01"}]'}));
assert.throws(() => tokenMonitorSettings({SYSTEM_CREDENTIAL_PROJECT_PATHS: '["a/b"]',
  SYSTEM_CREDENTIAL_EXPIRY_METADATA: '[{"projectPath":"a/b","key":"DOCKERHUB_TOKEN","expiresAt":"2027-01-01","token":"secret"}]'}));
console.log('PASS credential date boundaries, explicit scope, unsupported metadata and response redaction.');
