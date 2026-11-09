import crypto from 'crypto';
import fs from 'fs';
import {mainConfigPath} from './StatePaths';
import {rails, startJob, lookupJob} from './ProjectBootstrap';
const {assignments, literal} = require('../../system/wizard-public');
const purposes: Record<string, [string, string]> = {
  RENOVATE_TOKEN: ['Renovate', 'GitLab'],
  SYSTEM_RELEASE_GITLAB_TOKEN: ['Release metadata access', 'GitLab'],
  GITHUB_RELEASE_TOKEN: ['GitHub release publication', 'GitHub'],
  DOCKERHUB_TOKEN: ['Container publication', 'Docker Hub']
};
const projectPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 255 &&
  /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+$/.test(value) && !value.split('/').some(part => ['.', '..'].includes(part));
const date = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

export function tokenEnvironmentSettings(content: string) {
  const settings: Record<string, string> = {};
  for (const [name, value] of assignments(content)) {
    if (['SYSTEM_CREDENTIAL_PROJECT_PATHS', 'SYSTEM_CREDENTIAL_WARNING_DAYS', 'SYSTEM_CREDENTIAL_EXPIRY_METADATA'].includes(name))
      settings[name] = literal(value);
  }
  return tokenMonitorSettings(settings);
}

export function tokenMonitorSettings(settings: Record<string, string>) {
  let projects: unknown = [], metadata: unknown = [];
  try {
    projects = JSON.parse(settings.SYSTEM_CREDENTIAL_PROJECT_PATHS || '[]');
    metadata = JSON.parse(settings.SYSTEM_CREDENTIAL_EXPIRY_METADATA || '[]');
  } catch { throw new Error('Credential monitoring settings must contain valid JSON.'); }
  if (!Array.isArray(projects) || projects.length > 8 || !projects.every(projectPath) ||
      new Set(projects).size !== projects.length) throw new Error('Choose up to eight distinct GitLab automation project paths.');
  const warningDays = Number(settings.SYSTEM_CREDENTIAL_WARNING_DAYS || '14');
  if (!Number.isInteger(warningDays) || warningDays < 1 || warningDays > 90) throw new Error('Credential warning days must be between 1 and 90.');
  if (!Array.isArray(metadata) || metadata.length > 32 || metadata.some(row => !row ||
      Object.keys(row).some(key => !['projectPath', 'key', 'expiresAt'].includes(key)) ||
      !projects.includes(row.projectPath) || !['GITHUB_RELEASE_TOKEN', 'DOCKERHUB_TOKEN'].includes(row.key) || !date(row.expiresAt))) {
    throw new Error('External expiry metadata requires a selected project, supported credential key and valid expiry date.');
  }
  if (new Set(metadata.map(row => row.projectPath + ':' + row.key)).size !== metadata.length) throw new Error('Duplicate external credential expiry metadata.');
  return {projects: projects as string[], warningDays, metadata: metadata as Array<{projectPath: string, key: string, expiresAt: string}>};
}

export function credentialExpiry(expiresAt: unknown, revoked: boolean, warningDays = 14, now = Date.now()) {
  if (revoked) return {status: 'revoked', daysRemaining: null};
  if (!date(expiresAt)) return {status: 'unknown', daysRemaining: null};
  const remaining = Date.parse(expiresAt + 'T00:00:00Z') - now;
  return {status: remaining <= 0 ? 'expired' : Math.ceil(remaining / 86400000) <= warningDays ? 'expiring' : 'valid',
    daysRemaining: Math.max(0, Math.ceil(remaining / 86400000))};
}

export function safeTokenOverview(native: any, settings: ReturnType<typeof tokenMonitorSettings>, now = Date.now()) {
  const rows = Array.isArray(native?.credentials) ? native.credentials : [];
  const credentials = settings.projects.flatMap(path => Object.entries(purposes).map(([key, [purpose, provider]]) => {
    const row = rows.find((value: any) => value?.projectPath === path && value?.key === key);
    const observed = row?.expirySource === 'gitlab' && provider === 'GitLab';
    const recorded = settings.metadata.find(value => value.projectPath === path && value.key === key);
    const expiresAt = observed && date(row?.expiresAt) ? row.expiresAt : recorded?.expiresAt || null;
    const revoked = observed && row?.revoked === true;
    return {projectPath: path, key, purpose, provider, configured: row?.configured === true,
      expiresAt, expirySource: observed ? 'gitlab' : recorded ? 'operator-recorded' : 'unavailable',
      ...credentialExpiry(expiresAt, revoked, settings.warningDays, now),
      renewalGuide: key === 'RENOVATE_TOKEN' ? '#docs/dependency-updates' : '#docs/token-expiry'};
  }));
  return {version: 1, state: 'complete', observedAt: new Date(now).toISOString(),
    warningDays: settings.warningDays, projects: settings.projects, credentials,
    permissionCheck: false, readOnly: true};
}

let cached: {key: string, at: number, result: any} | undefined;
export function tokenOverview() {
  const settings = tokenEnvironmentSettings(fs.readFileSync(mainConfigPath(), 'utf8'));
  const key = crypto.createHash('sha256').update(JSON.stringify(settings)).digest('hex');
  if (cached?.key === key && Date.now() - cached.at < 300000) return cached.result;
  if (!settings.projects.length) return safeTokenOverview({}, settings);
  const id = 'tokens-' + key;
  const previous = lookupJob(id);
  if (previous?.state === 'running') return previous;
  return startJob(id, async () => {
    const result = safeTokenOverview(await rails({action: 'token-expiry-status', projects: settings.projects}), settings);
    cached = {key, at: Date.now(), result};
    return result;
  });
}
