'use strict';
// GitHub presents the accepted GitLab attempt. No image/source rebuild belongs here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {context: hubContext, readEvidence, manifest: inspectManifest} = require('./publish-dockerhub');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw Error(message); };
const revision = value => /^[a-f0-9]{40}$/.test(value || '');
const semver = value => /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(value || '');
const bounded = file => {
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 8 * 1024 ** 2, 'Regular bounded release inputs required.');
  return fs.readFileSync(file);
};
function token(env, name) {
  if (env[name + '_FILE']) {
    const stat = fs.lstatSync(env[name + '_FILE']);
    requireValue(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.size <= 16384,
      'Private scoped publication credential file required.');
    const value = bounded(env[name + '_FILE']).toString().trim();
    requireValue(value && !/[\r\n]/.test(value), 'A single scoped credential required.');
    return value;
  }
  const value = env[name];
  requireValue(typeof value === 'string' && value.length > 0 && value.length < 16384 && !/[\r\n]/.test(value),
    'Scoped publication credential required.');
  return value;
}
function context(env, root) {
  requireValue(env.GITLAB_CI === 'true' && env.GITHUB_RELEASE_PUBLISH_ENABLED === 'true' &&
    env.GITHUB_BACKUP_ENABLED === 'true' && env.WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED === 'true' &&
    !env.CI_COMMIT_TAG && env.CI_COMMIT_BRANCH === env.CI_DEFAULT_BRANCH,
    'Protected native default-branch accepted release required.');
  const ci = hubContext(env), version = bounded(path.join(root, 'VERSION')).toString().trim();
  requireValue(semver(version) && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_RELEASE_REPOSITORY || '') &&
    !env.GITHUB_RELEASE_REPOSITORY.split('/').some(part => ['.', '..'].includes(part)),
    'Reviewed product version and GitHub repository required.');
  return {...ci, version, tag: 'v' + version, repository: env.GITHUB_RELEASE_REPOSITORY};
}
function api(origin, credential, header, request = fetch) {
  return async (route, options = {}) => {
    requireValue(route.startsWith('/') && !route.startsWith('//'), 'Fixed API origin required.');
    let response = await request(origin + route, {redirect: 'manual', signal: AbortSignal.timeout(30000),
      ...options, headers: {[header]: credential, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', ...(typeof options.body === 'string' ? {'Content-Type': 'application/json'} : {}), ...(options.headers || {})}});
    if (response.status === 302 && options.raw && origin === 'https://api.github.com') {
      const destination = new URL(response.headers.get('location'));
      requireValue(destination.protocol === 'https:' && !destination.username && !destination.password &&
        !destination.port && ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(destination.hostname),
        'Unapproved release-asset download redirect.');
      // Signed asset URLs never receive GitHub or GitLab credentials.
      response = await request(destination.href, {redirect: 'error', signal: AbortSignal.timeout(30000)});
    }
    if (response.status === 404) return null;
    requireValue(response.ok, 'Release API request failed.');
    const bytes = Buffer.from(await response.arrayBuffer());
    requireValue(bytes.length <= 8 * 1024 ** 2, 'Release API response too large.');
    return options.raw ? bytes : bytes.length ? JSON.parse(bytes) : {};
  };
}
async function gates(ci, env, root, gitlab) {
  const prefix = '/projects/' + ci.projectId;
  const project = await gitlab(prefix), pipeline = await gitlab(prefix + '/pipelines/' + ci.pipelineId);
  requireValue(project?.only_allow_merge_if_pipeline_succeeds === true && project.default_branch === env.CI_DEFAULT_BRANCH &&
    pipeline?.sha === ci.sourceRevision && pipeline.ref === env.CI_DEFAULT_BRANCH && pipeline.source === 'push' &&
    ['running', 'success'].includes(pipeline.status), 'Required GitLab acceptance and merge gate missing.');
  const branch = await gitlab(prefix + '/repository/branches/' + encodeURIComponent(env.CI_DEFAULT_BRANCH));
  requireValue(branch?.protected === true && branch.commit?.id === ci.sourceRevision, 'Accepted protected source must remain current.');
  const jobs = [];
  for (let page = 1; page <= 20; page++) {
    const rows = await gitlab(prefix + '/pipelines/' + ci.pipelineId + '/jobs?include_retried=false&per_page=100&page=' + page);
    requireValue(Array.isArray(rows), 'GitLab jobs unavailable.'); jobs.push(...rows);
    if (rows.length < 100) break;
    requireValue(page < 20, 'GitLab job enumeration too large.');
  }
  const required = ['check:documentation', 'prepare:wizard-source', 'test:candidate-image', 'test:platform-candidate', 'build',
    'test:wizard-browser', 'deploy:dockerhub', 'deploy:github',
    ...['gitlab', 'sync', 'gitlab-runner', 'bootstrapper', 'nginx', 'wizard', 'shared', 'performance'].map(value => 'test:isolated: [' + value + ']')];
  for (const name of required) {
    const rows = jobs.filter(row => row.name?.replace(/:\s*\[/, ': [') === name);
    requireValue(rows.length === 1 && rows[0].status === 'success' && rows[0].allow_failure === false &&
      rows[0].pipeline?.id === ci.pipelineId && rows[0].commit?.id === ci.sourceRevision,
      'Every required same-attempt acceptance/publication job must pass.');
  }
  requireValue(!jobs.some(row => row.id !== ci.publicationJobId && ['failed', 'canceled'].includes(row.status)), 'A pipeline job failed.');
  const owners = {'test-results/successor/release.json': 'test:platform-candidate',
    'test-results/successor/candidate-results.json': 'test:platform-candidate',
    'test-results/dockerhub/release.json': 'deploy:dockerhub', 'test-results/github/wizard-source.json': 'deploy:github'};
  for (const [file, owner] of Object.entries(owners)) {
    const job = jobs.find(row => row.name === owner);
    const bytes = await gitlab(prefix + '/jobs/' + job.id + '/artifacts/' + file, {raw: true});
    requireValue(bytes && hash(bytes) === hash(bounded(path.join(root, file))), 'Release input differs from its successful CI artifact.');
  }
  return jobs;
}
function publicMetadata(ci, released, publication, source, notes, quickstart) {
  requireValue(publication.format === 'system-public-release-v1' && publication.versionTag === null &&
    publication.platform === 'linux/amd64' && ['sourceRevision', 'sourceTree', 'wizardRevision', 'projectId', 'pipelineId']
      .every(key => publication[key] === released[key]) &&
    publication.upstreamRelease?.candidateJobId === released.candidateJobId &&
    publication.upstreamRelease?.candidateEvidenceSha256 === released.candidateEvidenceSha256,
    'Public images must belong to the accepted attempt.');
  for (const [role, id, sourceRevision, internal] of [['controller', released.imageId, released.sourceRevision, released.registryReference],
    ['wizard', released.wizardImageId, released.wizardRevision, released.wizardRegistryReference]]) {
    const row = publication[role];
    requireValue(row?.imageId === id && row.sourceRevision === sourceRevision &&
      /^(?:docker\.io\/)?[a-z0-9_-]+\/[a-z0-9._-]+@sha256:[a-f0-9]{64}$/.test(row.reference || '') &&
      row.reference.split('@')[1] === internal.split('@')[1] && /^sha256:[a-f0-9]{64}$/.test(row.configDigest || ''),
      'Published digest/source pair differs from the accepted image.');
  }
  requireValue(source.format === 'system-wizard-source-publication-v1' && source.projectId === ci.projectId &&
    source.pipelineId === ci.pipelineId && source.systemRevision === released.sourceRevision && source.wizardRevision === released.wizardRevision &&
    /^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.git$/.test(source.repository || '') && source.ref === 'refs/heads/system-release/' + released.wizardRevision,
    'Exact pinned Wizard source publication required.');
  return {format: 'system-accepted-release-v1', version: ci.version, tag: ci.tag, platform: 'linux/amd64',
    source: {repository: 'https://github.com/' + ci.repository + '.git', revision: released.sourceRevision,
      tree: released.sourceTree, wizardRepository: source.repository, wizardRevision: released.wizardRevision},
    images: Object.fromEntries(['controller', 'wizard'].map(role => [role, {
      reference: publication[role].reference, imageId: publication[role].imageId, configDigest: publication[role].configDigest}])),
    acceptance: {candidateJobId: released.candidateJobId, evidenceSha256: released.candidateEvidenceSha256,
      controllerWizardSameAttempt: true, requiredChecksPassed: true},
    compatibility: {os: 'Ubuntu', versions: ['24.04', '26.04'], architecture: 'amd64', minimumMemoryGiB: 8, minimumFreeDiskGiB: 40},
    quickstart: {file: 'quickstart.sh', sha256: hash(quickstart), hostInstallerSha256: ci.hostInstallerSha256}, releaseNotesSha256: hash(notes),
    documentation: {quickstart: 'https://github.com/' + ci.repository + '/blob/' + ci.tag + '/docs/QUICKSTART.md',
      recovery: 'https://github.com/' + ci.repository + '/blob/' + ci.tag + '/docs/RECOVERY_CONTRACT.md',
      upgrade: 'https://github.com/' + ci.repository + '/blob/' + ci.tag + '/docs/HANDBOOK.md#5-evolving-a-running-system',
      changelog: 'https://github.com/' + ci.repository + '/blob/' + ci.tag + '/CHANGELOG.md'}};
}
async function present(ci, assets, github, anonymous = github) {
  const prefix = '/repos/' + ci.repository;
  const commit = await anonymous(prefix + '/git/commits/' + ci.sourceRevision);
  requireValue(commit?.sha === ci.sourceRevision && commit.tree?.sha === ci.sourceTree, 'Exact source commit/tree must be public before presentation.');
  let tag = await github(prefix + '/git/ref/tags/' + ci.tag);
  if (!tag) {
    await github(prefix + '/git/refs', {method: 'POST', body: JSON.stringify({ref: 'refs/tags/' + ci.tag, sha: ci.sourceRevision})});
    tag = await github(prefix + '/git/ref/tags/' + ci.tag);
  }
  requireValue(tag?.object?.type === 'commit' && tag.object.sha === ci.sourceRevision, 'Public version tag is owned by another source.');
  const expected = {tag_name: ci.tag, target_commitish: ci.sourceRevision, name: 'System Bootstrapper ' + ci.version,
    body: assets['release-notes.md'].toString(), prerelease: false};
  let release = await github(prefix + '/releases/tags/' + ci.tag);
  if (!release) {
    for (let page = 1; page <= 20; page++) {
      const rows = await github(prefix + '/releases?per_page=100&page=' + page);
      requireValue(Array.isArray(rows), 'Release enumeration unavailable.');
      const matching = rows.filter(row => row.tag_name === ci.tag);
      requireValue(matching.length <= 1, 'Duplicate version releases.');
      if (matching.length) { release = matching[0]; break; }
      if (rows.length < 100) break;
      requireValue(page < 20, 'Release enumeration too large.');
    }
  }
  if (!release) release = await github(prefix + '/releases', {method: 'POST', body: JSON.stringify({...expected, draft: true})});
  requireValue(release && Object.entries(expected).every(([key, value]) => release[key] === value), 'Public version release is immutable.');
  for (const [name, bytes] of Object.entries(assets)) {
    const entries = (release.assets || []).filter(asset => asset.name === name);
    requireValue(entries.length <= 1, 'Duplicate release asset.');
    if (entries.length) {
      const existing = await github(prefix + '/releases/assets/' + entries[0].id, {raw: true,
        headers: {Accept: 'application/octet-stream'}});
      requireValue(existing && hash(existing) === hash(bytes), 'Public version asset already has different contents.');
    } else {
      requireValue(release.draft === true, 'Published releases cannot gain replacement assets.');
      await github('/uploads' + prefix + '/releases/' + release.id + '/assets?name=' + encodeURIComponent(name),
        {method: 'POST', body: bytes, headers: {'Content-Type': 'application/octet-stream'}});
    }
  }
  if (release.draft) await github(prefix + '/releases/' + release.id, {method: 'PATCH', body: JSON.stringify({draft: false, make_latest: 'true'})});
  const publicRelease = await anonymous(prefix + '/releases/tags/' + ci.tag);
  requireValue(publicRelease?.draft === false && Object.entries(expected).every(([key, value]) => publicRelease[key] === value), 'Published release must be anonymously retrievable.');
  for (const [name, bytes] of Object.entries(assets)) {
    const entries = (publicRelease.assets || []).filter(asset => asset.name === name);
    requireValue(entries.length === 1, 'Public release asset missing.');
    const downloaded = await anonymous(prefix + '/releases/assets/' + entries[0].id, {raw: true,
      headers: {Accept: 'application/octet-stream'}});
    requireValue(downloaded && hash(downloaded) === hash(bytes), 'Public asset retrieval mismatch.');
  }
  return publicRelease;
}
async function publish(env = process.env, root = process.cwd(), request = fetch) {
  const ci = context(env, root), {released} = readEvidence(root, ci, env);
  const origin = new URL(env.CI_API_V4_URL);
  requireValue(origin.protocol === 'https:' && !origin.username && !origin.password && !origin.search && !origin.hash,
    'Trusted HTTPS GitLab API required.');
  const gitlab = api(origin.href.replace(/\/$/, ''), token(env, 'SYSTEM_RELEASE_GITLAB_TOKEN'), 'PRIVATE-TOKEN', request);
  const jobs = await gates(ci, env, root, gitlab);
  const publication = JSON.parse(bounded(path.join(root, 'test-results/dockerhub/release.json')));
  requireValue(publication.publicationJobId === jobs.find(row => row.name === 'deploy:dockerhub').id, 'Image publisher job mismatch.');
  requireValue(released.candidateJobId === jobs.find(row => row.name === 'test:platform-candidate').id, 'Accepted candidate job mismatch.');
  const source = JSON.parse(bounded(path.join(root, 'test-results/github/wizard-source.json')));
  requireValue(source.publicationJobId === jobs.find(row => row.name === 'deploy:github').id, 'Source publisher job mismatch.');
  const changelog = bounded(path.join(root, 'CHANGELOG.md')).toString();
  const escapedVersion = ci.version.replace(/\./g, '\\.');
  const match = new RegExp('^## ' + escapedVersion + '\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))', 'm').exec(changelog);
  requireValue(match, 'Reviewed version changelog entry required.');
  const entries = match[1].trim().replace(/\]\((docs\/[^)]+)\)/g, '](' + 'https://github.com/' + ci.repository + '/blob/' + ci.tag + '/$1)');
  const notes = Buffer.from('# System Bootstrapper ' + ci.version + '\n' + entries + '\n\n' +
    'Exact source: `' + released.sourceRevision + '`; Wizard: `' + released.wizardRevision + '`.\n' +
    'Clone with Git, check out this tag and run `git submodule update --init --recursive`. GitHub source archives omit submodule contents.\n' +
    'See [Quickstart](https://github.com/' + ci.repository + '/blob/' + ci.tag + '/docs/QUICKSTART.md) and the versioned metadata asset.\n');
  const template = bounded(path.join(root, 'bootstrapper/quickstart.sh')).toString();
  const marker = 'ACCEPTED_RELEASE_TAG = None  # Replaced only in the accepted public release asset.';
  requireValue(template.split(marker).length === 2, 'Quickstart release binding marker required.');
  const repositoryMarker = "REPOSITORY = 'kihyoun/system'  # Replaced for the accepted public mirror.";
  requireValue(template.split(repositoryMarker).length === 2, 'Quickstart mirror binding marker required.');
  const quickstart = Buffer.from(template.replace(marker, "ACCEPTED_RELEASE_TAG = '" + ci.tag + "'  # Accepted public release.")
    .replace(repositoryMarker, "REPOSITORY = '" + ci.repository + "'  # Accepted public mirror."));
  ci.hostInstallerSha256 = hash(bounded(path.join(root, 'bootstrapper/install.sh')));
  const metadata = publicMetadata(ci, released, publication, source, notes, quickstart);
  ci.sourceTree = released.sourceTree;
  const identity = spawnSync('git', ['rev-parse', 'HEAD', 'HEAD^{tree}'], {cwd: root, encoding: 'utf8'});
  requireValue(identity.status === 0 && identity.stdout.trim() === ci.sourceRevision + '\n' + released.sourceTree, 'Checkout must match the accepted source/tree.');
  const mapping = spawnSync('git', ['config', '--blob', 'HEAD:.gitmodules', '--get', 'submodule.wizard.url'], {cwd: root, encoding: 'utf8'});
  requireValue(mapping.status === 0 && mapping.stdout.trim() === source.repository, 'Accepted public Wizard repository mapping mismatch.');
  const git = spawnSync('git', ['diff', '--quiet', '--exit-code', 'HEAD', '--', 'VERSION', 'CHANGELOG.md', 'bootstrapper/quickstart.sh'], {cwd: root});
  requireValue(git.status === 0, 'Release inputs must be reviewed committed source.');
  for (const role of ['controller', 'wizard']) {
    const [repository, digest] = metadata.images[role].reference.replace(/^docker\.io\//, '').split('@');
    const found = await inspectManifest(repository, digest, request);
    requireValue(found?.digest === digest && found.configDigest === metadata.images[role].configDigest, 'Accepted public images must remain anonymously available.');
  }
  const bytes = Buffer.from(JSON.stringify(metadata, null, 2) + '\n'), name = 'system-release-' + ci.tag + '.json';
  const assets = {[name]: bytes, [name + '.sha256']: Buffer.from(hash(bytes) + '  ' + name + '\n'),
    'quickstart.sh': quickstart, 'release-notes.md': notes};
  const credential = token(env, 'GITHUB_RELEASE_TOKEN');
  const base = api('https://api.github.com', 'Bearer ' + credential, 'Authorization', request);
  const github = (route, options) => route.startsWith('/uploads/')
    ? api('https://uploads.github.com', 'Bearer ' + credential, 'Authorization', request)(route.slice(8), options)
    : base(route, options);
  const anonymous = api('https://api.github.com', '', 'X-System-Public-Verification', request);
  const wizardRepository = source.repository.slice('https://github.com/'.length, -4);
  const wizardSource = await anonymous('/repos/' + wizardRepository + '/git/commits/' + released.wizardRevision);
  requireValue(wizardSource?.sha === released.wizardRevision, 'Exact pinned Wizard source must remain public.');
  const result = await present(ci, assets, github, anonymous);
  const output = path.join(root, 'test-results/public-release'); fs.mkdirSync(output, {recursive: true});
  for (const [file, value] of Object.entries(assets)) fs.writeFileSync(path.join(output, file), value);
  return {tag: ci.tag, url: result.html_url};
}
module.exports = {context, token, api, gates, publicMetadata, present, publish};
if (require.main === module) publish().then(value => console.log('Public accepted release: ' + value.tag)).catch(() => {
  console.error('Public release refused: verify protected credentials, successful same-attempt gates, public sources and immutable assets.'); process.exitCode = 1;
});
