// Exercise the actual pinned Renovate engine with in-memory platform/SCM adapters.
// Run this in the Renovate image; no live endpoint, token or dependency lookup.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const dist = path.resolve(process.argv[2] || '/usr/local/renovate/dist');
const load = name => import(pathToFileURL(path.join(dist, name + '.js')));
const [{getConfig}, {branchifyUpgrades}, {processBranch}, dashboards, {GlobalConfig},
  {default: apis}, {platformScmImpls}, {setPlatformApi}] = await Promise.all([
  load('config/defaults'), load('workers/repository/updates/branchify'),
  load('workers/repository/update/branch/index'), load('workers/repository/dependency-dashboard'),
  load('config/global'), load('modules/platform/api'), load('modules/platform/scm'), load('modules/platform/index'),
]);
await (await load('logger/index')).init();
const policy = JSON.parse(fs.readFileSync('renovate.json'));
const config = {...getConfig(), ...policy, semanticCommits: 'disabled', errors: [], warnings: [],
  repoIsOnboarded: true, baseBranch: 'main', dependencyDashboardChecks: {},
  lockFileMaintenance: {...getConfig().lockFileMaintenance, enabled: true}};
GlobalConfig.set({platform: 'gitlab', dryRun: null});
let issue, issueWrites = 0, checkoutCalls = 0;
const denied = name => () => { throw Error('Unexpected platform write: ' + name); };
apis.set('fixture', {
  getBranchPr: async () => null, findPr: async () => null,
  findIssue: async () => issue, getIssue: async () => issue,
  ensureIssue: async data => { issueWrites++; issue = {number: 1, body: data.body}; return 'created'; },
  ensureIssueClosing: denied('issue close'), maxBodyLength: () => 100000, massageMarkdown: text => text,
  createPr: denied('MR'), mergePr: denied('merge'), updatePr: denied('MR update'),
});
platformScmImpls.set('fixture', class {
  branchExists = async () => false;
  checkoutBranch = async () => { checkoutCalls++; throw Error('repository-changed'); };
  commitAndPush = denied('branch push');
});
setPlatformApi('fixture');
const dependency = (name, type = 'minor') => ({depName: name, packageName: name,
  datasource: 'npm', currentValue: '1.0.0', currentVersion: '1.0.0',
  updates: [{updateType: type, newValue: type === 'major' ? '2.0.0' : '1.1.0',
    newVersion: type === 'major' ? '2.0.0' : '1.1.0', newMajor: type === 'major' ? 2 : 1}]});
const packageFiles = {npm: [{packageFile: 'package.json', deps: [dependency('first'), dependency('second'), dependency('third', 'major')]}],
  dockerfile: [{packageFile: 'Dockerfile', deps: ['node','nginx'].map(name => ({...dependency(name), datasource: 'docker', currentValue: '24.0.0', updates: [{updateType: 'patch', newValue: '24.0.1', newVersion: '24.0.1', newMajor: 24}]}))}]};
const {branches} = await branchifyUpgrades(config, packageFiles);
assert.equal(branches.length, 4, 'npm and runtime batches, separate major and lockfile refresh');
const batch = branches.find(branch => branch.branchName === 'renovate/npm-compatible');
assert.equal(branches.find(branch => branch.branchName === 'renovate/runtime-compatible').upgrades.length, 2);
assert(branches.some(branch => branch.upgrades.some(update => update.isLockFileMaintenance)));
assert(batch, 'two compatible dependencies become one reviewable branch');
assert.equal(batch.branchName, 'renovate/npm-compatible');
for (const branch of branches) {
  Object.assign(branch, await processBranch({...config, ...branch}));
  assert.equal(branch.result, 'needs-approval');
  assert.equal(branch.branchExists, false);
}
assert.equal(checkoutCalls, 0, 'initial discovery never attempts branch preparation/push');
await dashboards.ensureDependencyDashboard(config, branches, packageFiles, {result: 'none'});
assert.equal(issueWrites, 1, 'discovery creates the Dashboard');
assert.match(issue.body, /Pending Approval/);
assert.match(issue.body, /first/);
assert.match(issue.body, /second/);
assert.match(issue.body, /approve-branch=renovate\/npm-compatible/);
await dashboards.readDashboardBody(config);
assert.equal(config.dependencyDashboardChecks[batch.branchName], undefined);
const unapproved = await processBranch({...config, ...batch});
assert.equal(unapproved.result, 'needs-approval');
assert.equal(checkoutCalls, 0);
issue.body = issue.body.replace('[ ] <!-- approve-branch=renovate/npm-compatible -->', '[x] <!-- approve-branch=renovate/npm-compatible -->');
await dashboards.readDashboardBody(config);
assert.equal(config.dependencyDashboardChecks[batch.branchName], 'approve');
await assert.rejects(processBranch({...config, ...batch, dependencyDashboardChecks: config.dependencyDashboardChecks}), /repository-changed/);
assert.equal(checkoutCalls, 1, 'only the explicitly approved batch reaches branch-update preparation');
const major = branches.find(branch => branch !== batch);
assert.equal((await processBranch({...config, ...major})).result, 'needs-approval');
assert.equal(checkoutCalls, 1, 'approval does not authorize unrelated major update');
assert.equal(batch.automerge, false);
console.log('PASS: real Renovate grouping, Dashboard creation, zero unapproved branch preparation, explicit batch approval and no automerge');
