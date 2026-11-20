'use strict';
// Secrets and the explicit repository allowlist come from protected CI variables.
const repositories = JSON.parse(process.env.RENOVATE_REPOSITORIES || '[]');
if (!Array.isArray(repositories) || ![1, 2].includes(repositories.length) ||
    new Set(repositories).size !== repositories.length ||
    !repositories.every(name => /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(name))) {
  throw new Error('RENOVATE_REPOSITORIES must select the System project path, optionally followed by the legacy Wizard project path');
}
if (!process.env.CI_API_V4_URL?.startsWith('https://') || !process.env.RENOVATE_TOKEN) {
  throw new Error('Protected GitLab endpoint and bot token are required');
}
module.exports = {
  platform: 'gitlab', endpoint: process.env.CI_API_V4_URL,
  autodiscover: false, repositories, onboarding: false, requireConfig: 'required',
  allowedCommands: [], allowScripts: false, exposeAllEnv: false,
  persistRepoData: false, baseDir: '/tmp/renovate',
  force: {
    dependencyDashboard: true, dependencyDashboardApproval: true,
    automerge: false, platformAutomerge: false, ignoreUnstable: true,
    branchPrefix: 'renovate/',
    vulnerabilityAlerts: {dependencyDashboardApproval: true, automerge: false, platformAutomerge: false},
    lockFileMaintenance: {dependencyDashboardApproval: true, automerge: false, platformAutomerge: false},
    postUpgradeTasks: {commands: []},
  },
};
