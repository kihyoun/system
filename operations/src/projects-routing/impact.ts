import { Settings, SemanticState, RoutingSnapshot } from './types';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as routing from './wizard-aliases';
import * as application from './application-aliases';
import { managed } from './managed-project';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid project receipt.');
  return value as Record<string, unknown>;
}
const routeKey =
  /^(?:USE_(?:PROD|BETA|REVIEW)_HOST|(?:PROD|BETA|REVIEW)_(?:HOST|DOMAIN_MODE|DEPLOY_MODE|SSL|SSL_KEY|ALIASES))$/;
const stable = (value: unknown) =>
  JSON.stringify(value, (_, item) =>
    item && !Array.isArray(item) && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export function ownership(content: string, values: Settings) {
  const lines = content
    .split('\n')
    .filter((line) => /^# BOOTSTRAPPER_(?:PROJECT|REPOSITORY)=/.test(line));
  const receipts = lines.filter((line) => line.startsWith('# BOOTSTRAPPER_PROJECT='));
  const annotations = lines.filter((line) => line.startsWith('# BOOTSTRAPPER_REPOSITORY='));
  if (receipts.length > 1 || annotations.length > 1)
    throw Error('Duplicate project ownership metadata.');
  let repository: unknown;
  if (annotations.length)
    repository = JSON.parse(
      decodeURIComponent(annotations[0].slice('# BOOTSTRAPPER_REPOSITORY='.length)),
    );
  if (!receipts.length) return lines;
  const encoded = receipts[0].slice('# BOOTSTRAPPER_PROJECT='.length),
    bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || !Buffer.from(bytes.toString('utf8')).equals(bytes))
    throw Error('Invalid project receipt.');
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  const receipt = object(parsed);
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt))
    throw Error('Invalid project receipt.');
  if (!receipt.repository) return lines;
  const authoritative = object(receipt.repository);
  if (
    receipt.state !== 'complete' ||
    receipt.template !== values.PROJECT_TEMPLATE ||
    !Number.isSafeInteger(authoritative.id) ||
    typeof authoritative.id !== 'number' ||
    authoritative.id <= 0 ||
    !Number.isSafeInteger(authoritative.namespaceId) ||
    typeof authoritative.namespaceId !== 'number' ||
    authoritative.namespaceId <= 0 ||
    !['string', 'number'].includes(typeof receipt.namespaceId) ||
    String(receipt.namespaceId) !== String(authoritative.namespaceId) ||
    typeof authoritative.path !== 'string' ||
    !authoritative.path ||
    typeof authoritative.defaultBranch !== 'string' ||
    !authoritative.defaultBranch
  )
    throw Error('Invalid project repository identity.');
  if (
    repository !== undefined &&
    repository !== null &&
    stable(repository) !== stable(authoritative)
  )
    throw Error('Project repository annotation differs from its receipt.');
  // Save can precede repository creation. Fetch derives this annotation from
  // the receipt; only that verified projection may be absent/null/refreshed.
  // Retain the authoritative line byte-for-byte in comparisons/fingerprints.
  return receipts;
}
export function semantic(content: string) {
  routing.signature(content);
  const values = routing.settings(
    content,
    new Set(routing.records(content).map((record) => record.key)),
  );
  return { values, ownership: ownership(content, values) };
}
export function mainSemantic(content: string) {
  const result = semantic(content);
  // The established Wizard export omits inactive TLS fields. Their omission
  // must not turn an ordinary HTTP installation's routing edit into downtime.
  for (const prefix of ['GITLAB', 'GITLAB_REGISTRY', 'SYNC', 'WIZARD'])
    if (
      ['0', '1'].includes(result.values[prefix + '_DOMAIN_MODE']) &&
      !(prefix === 'WIZARD' && result.values.WIZARD_ALIASES?.trim())
    ) {
      delete result.values[prefix + '_SSL'];
      delete result.values[prefix + '_SSL_KEY'];
    }
  return result;
}
export function impact(archive: string, current: string) {
  const incoming = application.imported(archive, current);
  const previousMain = path.join(current, '.docker.env');
  const previous = routing.projectFiles(path.join(current, '.projects.env'));
  const snapshot = {
    main: fs.existsSync(previousMain) ? fs.readFileSync(previousMain, 'utf8') : '',
    projects: previous,
  };
  const extraFiles = fs
    .readdirSync(archive)
    .filter((name) => name.endsWith('.env') && name !== '.docker.env' && name !== '.projects.env')
    .sort()
    .map((name) => ({
      name,
      incoming: fs.readFileSync(path.join(archive, name), 'utf8'),
      previous: fs.existsSync(path.join(current, name))
        ? fs.readFileSync(path.join(current, name), 'utf8')
        : null,
    }));
  let mode: 'restart' | 'routing' | 'none' = 'restart',
    projects: string[] = [];
  try {
    if (extraFiles.some((file) => file.incoming !== file.previous))
      throw Error('Additional configuration changed.');
    const oldMain = mainSemantic(snapshot.main),
      newMain = mainSemantic(incoming.main);
    if (stable(oldMain) !== stable(newMain)) throw Error('Main settings changed.');
    if (
      stable(previous.map((file) => file.name)) !==
      stable(incoming.projects.map((file) => file.name).sort())
    )
      throw Error('Project set changed.');
    for (const file of incoming.projects) {
      const old = previous.find((item) => item.name === file.name);
      const before = semantic(old!.content),
        after = semantic(file.content);
      if (stable(before) === stable(after)) continue;
      if (
        managed(old!.content) ||
        before.values.PROJECT_TEMPLATE === 'wizard' ||
        before.values.PROJECT_NAME !== after.values.PROJECT_NAME ||
        !/^[a-z0-9]+$/.test(after.values.PROJECT_NAME) ||
        file.name !== '.' + after.values.PROJECT_NAME + '.env' ||
        stable(before.ownership) !== stable(after.ownership)
      )
        throw Error('Project ownership changed.');
      const changed = new Set([...Object.keys(before.values), ...Object.keys(after.values)]);
      for (const key of changed)
        if (before.values[key] !== after.values[key] && !routeKey.test(key))
          throw Error('Non-routing project settings changed.');
      projects.push(after.values.PROJECT_NAME);
    }
    mode = projects.length ? 'routing' : 'none';
  } catch (_) {
    projects = [];
  }
  const normalized = (state: RoutingSnapshot) => {
    try {
      return {
        main: semantic(state.main),
        projects: state.projects
          .map((file) => ({ name: file.name, data: semantic(file.content) }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    } catch (_) {
      return state;
    }
  };
  const fingerprint = crypto
    .createHash('sha256')
    .update(stable({ previous: normalized(snapshot), incoming: normalized(incoming), extraFiles }))
    .digest('hex');
  return { mode, projects: projects.sort(), fingerprint };
}
