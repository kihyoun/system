'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {test} = require('node:test');
const {context, token, api, gates, publicMetadata, present} = require('../../gitlab/publish-github-release');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sha = 'a'.repeat(40), tree = 'b'.repeat(40), wizard = 'c'.repeat(40), id = n => 'sha256:' + n.repeat(64);
const environment = {GITLAB_CI: 'true', GITHUB_RELEASE_PUBLISH_ENABLED: 'true', GITHUB_BACKUP_ENABLED: 'true',
  WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED: 'true', DOCKERHUB_PUBLISH_ENABLED: 'true', GITHUB_RELEASE_REPOSITORY: 'example/system',
  CI_PIPELINE_SOURCE: 'push', CI_COMMIT_REF_PROTECTED: 'true', CI_COMMIT_BRANCH: 'master', CI_DEFAULT_BRANCH: 'master',
  CI_COMMIT_SHA: sha, CI_PROJECT_ID: '4', CI_PIPELINE_ID: '10', CI_JOB_ID: '40', CI_REGISTRY: 'registry.example.test',
  CI_PROJECT_PATH: 'example/system', CI_REGISTRY_IMAGE: 'registry.example.test/example/system',
  DOCKERHUB_REPOSITORY: 'example/system', DOCKERHUB_WIZARD_REPOSITORY: 'example/wizard'};
const ci = {sourceRevision: sha, sourceTree: tree, projectId: 4, pipelineId: 10, publicationJobId: 40,
  repository: 'example/system', version: '1.0.0', tag: 'v1.0.0', hostInstallerSha256: 'f'.repeat(64)};
const released = {sourceRevision: sha, sourceTree: tree, wizardRevision: wizard, projectId: 4, pipelineId: 10,
  imageId: id('1'), wizardImageId: id('2'), candidateJobId: 20, candidateEvidenceSha256: 'd'.repeat(64),
  registryReference: 'private.example.test/system/successor@' + id('3'),
  wizardRegistryReference: 'private.example.test/system/successor-wizard@' + id('4')};
const publication = {format: 'system-public-release-v1', versionTag: null, platform: 'linux/amd64',
  sourceRevision: sha, sourceTree: tree, wizardRevision: wizard, projectId: 4, pipelineId: 10,
  upstreamRelease: {candidateJobId: 20, candidateEvidenceSha256: released.candidateEvidenceSha256},
  controller: {imageId: id('1'), sourceRevision: sha, reference: 'example/system@' + id('3'), configDigest: id('1')},
  wizard: {imageId: id('2'), sourceRevision: wizard, reference: 'example/wizard@' + id('4'), configDigest: id('2')}};
const source = {format: 'system-wizard-source-publication-v1', projectId: 4, pipelineId: 10,
  systemRevision: sha, wizardRevision: wizard, repository: 'https://github.com/kihyoun/system-wizard.git',
  ref: 'refs/heads/system-release/' + wizard};

test('only protected native default-branch accepts reviewed SemVer, scoped external credentials', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-release-context-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.writeFileSync(path.join(root, 'VERSION'), '1.0.0\n');
  assert.equal(context(environment, root).tag, 'v1.0.0');
  for (const patch of [{CI_PIPELINE_SOURCE: 'merge_request_event'}, {CI_COMMIT_REF_PROTECTED: 'false'},
    {CI_COMMIT_TAG: 'v1.0.0'}, {GITHUB_RELEASE_PUBLISH_ENABLED: 'false'}, {CI_COMMIT_BRANCH: 'feature'},
    {GITHUB_RELEASE_REPOSITORY: 'https://attacker.invalid/repo'}]) assert.throws(() => context({...environment, ...patch}, root));
  for (const version of ['v1.0.0', '01.0.0', '1.0', '1.0.0-rc1', '1.0.0\nmalicious']) {
    fs.writeFileSync(path.join(root, 'VERSION'), version); assert.throws(() => context(environment, root));
  }
  const file = path.join(root, 'token'); fs.writeFileSync(file, 'private-fixture-token\n', {mode: 0o600});
  assert.equal(token({GITHUB_RELEASE_TOKEN_FILE: file, GITHUB_RELEASE_TOKEN: 'wrong-fallback'}, 'GITHUB_RELEASE_TOKEN'), 'private-fixture-token');
  fs.chmodSync(file, 0o644); assert.throws(() => token({GITHUB_RELEASE_TOKEN_FILE: file}, 'GITHUB_RELEASE_TOKEN'));
  assert.throws(() => token({}, 'GITHUB_RELEASE_TOKEN'));
});

test('public metadata keeps exact accepted pair, excludes internal registry and raw evidence', () => {
  const metadata = publicMetadata(ci, released, publication, source, Buffer.from('notes'), Buffer.from('quickstart'));
  assert.equal(metadata.version, '1.0.0');
  assert.equal(metadata.source.wizardRevision, wizard);
  assert.equal(metadata.images.controller.reference, publication.controller.reference);
  assert.equal(metadata.acceptance.evidenceSha256, released.candidateEvidenceSha256);
  assert.equal(metadata.quickstart.sha256, hash('quickstart'));
  assert(!JSON.stringify(metadata).includes('private.example.test'));
  for (const patch of [{pipelineId: 11}, {sourceTree: sha}, {versionTag: 'v1.0.0'},
    {upstreamRelease: {...publication.upstreamRelease, candidateJobId: 21}},
    {wizard: {...publication.wizard, imageId: id('9')}},
    {controller: {...publication.controller, reference: 'example/system@' + id('9')}}])
    assert.throws(() => publicMetadata(ci, released, {...publication, ...patch}, source, Buffer.from('n'), Buffer.from('q')));
  assert.throws(() => publicMetadata(ci, released, publication, {...source, wizardRevision: sha}, Buffer.from('n'), Buffer.from('q')));
});

function githubFixture() {
  let tag = null, release = null, nextAsset = 1, failUpload = false;
  const contents = new Map(), calls = [];
  const call = async (route, options = {}) => {
    calls.push({route, options});
    if (route.includes('/git/commits/')) return {sha, tree: {sha: tree}};
    if (route.includes('/git/ref/tags/')) return tag;
    if (route.endsWith('/git/refs')) { tag = {object: {type: 'commit', sha: JSON.parse(options.body).sha}}; return tag; }
    if (route.includes('/releases?')) return release ? [structuredClone(release)] : [];
    if (route.includes('/releases/tags/')) return release?.draft ? null : release && structuredClone(release);
    if (route.endsWith('/releases') && options.method === 'POST') {
      release = {...JSON.parse(options.body), id: 50, assets: [], html_url: 'https://github.com/example/system/releases/tag/v1.0.0'};
      return structuredClone(release);
    }
    if (route.startsWith('/uploads/')) {
      if (failUpload) { failUpload = false; throw Error('fixture-disconnected-upload'); }
      const name = decodeURIComponent(route.split('?name=')[1]), asset = {name, id: nextAsset++};
      release.assets.push(asset); contents.set(asset.id, Buffer.from(options.body)); return asset;
    }
    if (route.includes('/releases/assets/')) return contents.get(Number(route.split('/').pop()));
    if (route.endsWith('/releases/50') && options.method === 'PATCH') { release.draft = false; return structuredClone(release); }
    throw Error('Unexpected API request: ' + route);
  };
  return {call, calls, contents, setTag: value => { tag = value; }, setFail: () => { failUpload = true; },
    getRelease: () => release};
}

test('interrupted draft retries complete the same immutable attempt; published retries write nothing', async () => {
  const fixture = githubFixture(), assets = {'release-notes.md': Buffer.from('Reviewed notes\n'),
    'system-release-v1.0.0.json': Buffer.from('{"version":"1.0.0"}\n'), 'quickstart.sh': Buffer.from('# exact source\n')};
  fixture.setFail();
  await assert.rejects(present(ci, assets, fixture.call), /disconnected-upload/);
  assert.equal(fixture.getRelease().draft, true);
  await present(ci, assets, fixture.call);
  assert.equal(fixture.getRelease().draft, false);
  fixture.calls.length = 0;
  await present(ci, assets, fixture.call);
  assert(!fixture.calls.some(row => row.options.method), 'idempotent public retry performs no writes');
  const changed = {...assets, 'quickstart.sh': Buffer.from('different accepted attempt')};
  await assert.rejects(present(ci, changed, fixture.call), /different contents/);
  await assert.rejects(present(ci, {...assets, 'extra.txt': Buffer.from('new')}, fixture.call), /cannot gain/);
  assert.equal(fixture.getRelease().assets.length, 3);
  assert(!fixture.calls.some(row => row.options.method === 'DELETE'), 'no asset or version is removed to make retry pass');
});

test('conflicting public source tag is never reassigned', async () => {
  const fixture = githubFixture(); fixture.setTag({object: {type: 'commit', sha: wizard}});
  await assert.rejects(present(ci, {'release-notes.md': Buffer.from('notes')}, fixture.call), /another source/);
  assert(!fixture.calls.some(row => row.options.method));
});

test('asset redirects receive no publication token and foreign redirects fail closed', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({url, options});
    return calls.length === 1 ? new Response(null, {status: 302,
      headers: {location: 'https://release-assets.githubusercontent.com/github-production-release-asset/file?signature=fixture'}}) : new Response('asset');
  };
  const result = await api('https://api.github.com', 'Bearer fixture-token', 'Authorization', request)('/repos/example/system/releases/assets/1', {raw: true});
  assert.equal(result.toString(), 'asset');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fixture-token');
  assert.equal(calls[1].options.headers, undefined);
  const hostile = async () => new Response(null, {status: 302, headers: {location: 'https://attacker.invalid/token'}});
  await assert.rejects(api('https://api.github.com', 'fixture-token', 'Authorization', hostile)('/repos/example/system/releases/assets/1', {raw: true}), /Unapproved/);
});

test('gates bind required successful jobs and byte-identical artifacts before GitHub writes', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-release-gates-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const files = ['test-results/successor/release.json', 'test-results/successor/candidate-results.json',
    'test-results/dockerhub/release.json', 'test-results/github/wizard-source.json'];
  for (const file of files) { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), file); }
  const names = ['check:documentation', 'prepare:wizard-source', 'test:candidate-image', 'test:platform-candidate', 'build',
    'test:wizard-browser', 'deploy:dockerhub', 'deploy:github', ...['gitlab', 'sync', 'gitlab-runner', 'bootstrapper', 'nginx', 'wizard', 'shared', 'performance'].map(name => 'test:isolated: [' + name + ']')];
  const jobs = names.map((name, index) => ({name, id: index + 1, status: 'success', allow_failure: false,
    pipeline: {id: 10}, commit: {id: sha}}));
  const gitlab = async (route, options) => {
    if (options?.raw) return Buffer.from(route.split('/artifacts/')[1]);
    if (route.includes('/repository/branches/')) return {protected: true, commit: {id: sha}};
    if (route.includes('/jobs?')) return jobs;
    if (route.includes('/pipelines/')) return {sha, ref: 'master', source: 'push', status: 'running'};
    return {only_allow_merge_if_pipeline_succeeds: true, default_branch: 'master'};
  };
  await gates(ci, environment, root, gitlab);
  jobs.find(row => row.name === 'test:wizard-browser').status = 'failed';
  await assert.rejects(gates(ci, environment, root, gitlab), /Every required/);
  jobs.find(row => row.name === 'test:wizard-browser').status = 'success';
  fs.writeFileSync(path.join(root, files[0]), 'another attempted release');
  await assert.rejects(gates(ci, environment, root, gitlab), /differs/);
});

test('complete publisher derives deterministic public assets from one accepted real Git checkout without rebuilding', async t => {
  const {spawnSync} = require('node:child_process');
  const {publish} = require('../../gitlab/publish-github-release');
  const security = require('../../gitlab/security-release.json');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'github-release-full-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const git = (...args) => {
    const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git('init', '--quiet'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.mkdirSync(path.join(root, 'bootstrapper'));
  for (const name of ['quickstart.sh', 'install.sh']) fs.copyFileSync(path.join(__dirname, '../../bootstrapper', name), path.join(root, 'bootstrapper', name));
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\n## 1.0.0\n\nReviewed fixture release. See [Quickstart](docs/QUICKSTART.md).\n');
  fs.writeFileSync(path.join(root, 'VERSION'), '1.0.0\n');
  fs.writeFileSync(path.join(root, '.gitmodules'), '[submodule "wizard"]\npath = wizard\nurl = https://github.com/kihyoun/system-wizard.git\n');
  git('add', '.'); git('update-index', '--add', '--cacheinfo', '160000,' + wizard + ',wizard'); git('commit', '--quiet', '-m', 'Accepted fixture');
  const commit = git('rev-parse', 'HEAD'), sourceTree = git('rev-parse', 'HEAD^{tree}');
  const env = {...environment, CI_COMMIT_SHA: commit, CI_API_V4_URL: 'https://gitlab.example.test/api/v4',
    SYSTEM_RELEASE_GITLAB_TOKEN: 'fixture-gitlab', GITHUB_RELEASE_TOKEN: 'fixture-github'};
  const manifests = Object.fromEntries(['controller', 'wizard'].map((role, index) => [role, Buffer.from(JSON.stringify({schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json', config: {digest: id(String(index + 1))}, layers: []}))]));
  const digests = Object.fromEntries(Object.entries(manifests).map(([role, raw]) => [role, 'sha256:' + hash(raw)]));
  const proof = {runId: 'f'.repeat(24), sourceRevision: commit, fullAcceptance: true,
    images: {candidate: id('1'), wizard: id('2'), runner: id('3')},
    results: ['gitlab-upgrade-migrated-data', 'gitlab-upgrade-registry-ci', 'gitlab-upgrade-restored-checkpoint',
      'gitlab-upgrade-security-trust', 'storage-global-live-lease', 'storage-refuse-nonempty-and-corrupt-restore',
      'storage-detached-backup-normal-operation', 'cleanup'].map(name => ({name, status: 'passed'})),
    evidence: {gitlabUpgrade: {fromImage: security.fromImage, toImage: security.toImage, migrationVerified: true,
      rollbackVerified: true, registryVerified: true, checkpointVerified: true,
      runnerImage: security.runner.toImage, runnerImageId: id('3'), fromRunnerImageId: id('4'), helperImageId: id('5'),
      fromHelperImageId: id('6'), runnerUpgradeVerified: true, runnerManagerIdentityPreserved: true,
      runnerVersion: security.runner.toVersion, helperImage: security.runner.helperImage,
      jobCaBundleSha256: security.jobCaBundleSha256, securityTrustVerified: true},
    storage: {localLiveVerified: true, externalSeedRestored: true, backupDetached: true, missingBackupGuardVerified: true,
      globalLeaseVerified: true, invalidRestoreGuardVerified: true}}};
  const proofBytes = Buffer.from(JSON.stringify(proof));
  const accepted = {...released, format: 'system-successor-release-v1', sourceRevision: commit, sourceTree,
    registryRepository: env.CI_REGISTRY_IMAGE + '/successor', candidateEvidenceSha256: hash(proofBytes),
    candidateEvidencePath: 'test-results/successor/candidate-results.json',
    registryReference: env.CI_REGISTRY_IMAGE + '/successor@' + digests.controller,
    wizardRegistryReference: env.CI_REGISTRY_IMAGE + '/successor-wizard@' + digests.wizard};
  const publicPair = {...publication, sourceRevision: commit, sourceTree, publicationJobId: 7,
    upstreamRelease: {...publication.upstreamRelease, candidateEvidenceSha256: hash(proofBytes)},
    controller: {...publication.controller, sourceRevision: commit, reference: 'example/system@' + digests.controller},
    wizard: {...publication.wizard, reference: 'example/wizard@' + digests.wizard}};
  const publicSource = {...source, systemRevision: commit, publicationJobId: 8};
  const inputs = {'test-results/successor/release.json': Buffer.from(JSON.stringify(accepted)),
    'test-results/successor/candidate-results.json': proofBytes, 'test-results/dockerhub/release.json': Buffer.from(JSON.stringify(publicPair)),
    'test-results/github/wizard-source.json': Buffer.from(JSON.stringify(publicSource))};
  for (const [file, bytes] of Object.entries(inputs)) { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), bytes); }
  const names = ['check:documentation', 'prepare:wizard-source', 'test:candidate-image', 'test:platform-candidate', 'build',
    'test:wizard-browser', 'deploy:dockerhub', 'deploy:github', ...['gitlab', 'sync', 'gitlab-runner', 'bootstrapper', 'nginx', 'wizard', 'shared', 'performance'].map(name => 'test:isolated: [' + name + ']')];
  const jobs = names.map((name, index) => ({name, id: name === 'test:platform-candidate' ? 20 : index + 1,
    status: 'success', allow_failure: false, pipeline: {id: 10}, commit: {id: commit}}));
  const fixture = githubFixture();
  const request = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'gitlab.example.test') {
      assert.equal(options.headers['PRIVATE-TOKEN'], 'fixture-gitlab');
      if (parsed.pathname.includes('/artifacts/')) return new Response(inputs[parsed.pathname.split('/artifacts/')[1]]);
      if (parsed.pathname.includes('/repository/branches/')) return Response.json({protected: true, commit: {id: commit}});
      if (parsed.pathname.endsWith('/jobs')) return Response.json(jobs);
      if (parsed.pathname.includes('/pipelines/')) return Response.json({sha: commit, ref: 'master', source: 'push', status: 'running'});
      return Response.json({only_allow_merge_if_pipeline_succeeds: true, default_branch: 'master'});
    }
    assert(!options.headers?.['PRIVATE-TOKEN'], 'GitLab API credential never leaves GitLab');
    if (parsed.hostname === 'auth.docker.io') return Response.json({token: 'public-registry-token'});
    if (parsed.hostname === 'registry-1.docker.io') {
      assert.equal(options.headers.Authorization, 'Bearer public-registry-token');
      const role = parsed.pathname.includes('/example/wizard/') ? 'wizard' : 'controller';
      return new Response(manifests[role], {headers: {'docker-content-digest': digests[role]}});
    }
    assert(['api.github.com', 'uploads.github.com'].includes(parsed.hostname));
    if (parsed.pathname.includes('/git/commits/')) {
      const isWizard = parsed.pathname.includes('/kihyoun/system-wizard/');
      return Response.json({sha: isWizard ? wizard : commit, tree: {sha: sourceTree}});
    }
    // The fixture's source constants are independent; map the accepted commit
    // only at the public GitHub boundary, then retain its exact release fields.
    const result = await fixture.call((parsed.hostname === 'uploads.github.com' ? '/uploads' : '') + parsed.pathname + parsed.search, options);
    if (result === null) return new Response(null, {status: 404});
    return Buffer.isBuffer(result) ? new Response(result) : Response.json(result);
  };
  const result = await publish(env, root, request);
  assert.equal(result.tag, 'v1.0.0');
  const published = JSON.parse(fs.readFileSync(path.join(root, 'test-results/public-release/system-release-v1.0.0.json')));
  assert.equal(published.source.revision, commit);
  assert.equal(published.images.controller.reference, publicPair.controller.reference);
  assert.equal(published.quickstart.sha256, hash(fs.readFileSync(path.join(root, 'test-results/public-release/quickstart.sh'))));
  assert.match(fs.readFileSync(path.join(root, 'test-results/public-release/quickstart.sh'), 'utf8'), /ACCEPTED_RELEASE_TAG = 'v1.0.0'/);
  assert(!JSON.stringify(published).includes('registry.example.test'));
  assert.equal(fixture.getRelease().assets.length, 4);
  fixture.calls.length = 0;
  await publish(env, root, request);
  assert(!fixture.calls.some(row => row.options.method), 'full native publication retry reuses the identical evidence/assets');
});

test('real Fetch transport exposes asset 302 without following it with the API credential', async t => {
  const http = require('node:http'), requests = [];
  const server = http.createServer((request, response) => {
    requests.push({path: request.url, authorization: request.headers.authorization});
    if (request.url === '/asset') response.end('actual-http-asset');
    else { response.writeHead(302, {Location: 'https://release-assets.githubusercontent.com/asset'}); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const request = (url, options) => fetch('http://127.0.0.1:' + server.address().port + new URL(url).pathname, options);
  const downloaded = await api('https://api.github.com', 'Bearer scoped-fixture', 'Authorization', request)(
    '/repos/example/system/releases/assets/1', {raw: true, headers: {Accept: 'application/octet-stream'}});
  assert.equal(downloaded.toString(), 'actual-http-asset');
  assert.deepEqual(requests, [{path: '/repos/example/system/releases/assets/1', authorization: 'Bearer scoped-fixture'},
    {path: '/asset', authorization: undefined}]);
});
