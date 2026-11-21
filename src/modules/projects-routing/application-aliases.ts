import { ApplicationRoute, requireValue } from './types';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as routing from './wizard-aliases';
import { managed } from './managed-project';
const prefixes = ['PROD', 'BETA', 'REVIEW'];
export const keys = new Set([
  'PROJECT_NAME',
  'PROJECT_TEMPLATE',
  ...prefixes.flatMap((prefix) => [
    'USE_' + prefix + '_HOST',
    ...['HOST', 'DOMAIN_MODE', 'SSL', 'SSL_KEY', 'ALIASES'].map((key) => prefix + '_' + key),
  ]),
]);
export function certificatePath(value: string) {
  requireValue(
    typeof value === 'string' &&
      /^\/ssl\/[A-Za-z0-9_./-]+$/.test(value) &&
      path.posix.normalize(value) === value &&
      !value.endsWith('/'),
    'Use certificate and key files within /ssl.',
  );
  return value;
}
export function certificates(selected: ApplicationRoute[]) {
  for (const route of selected) {
    let certificate, key;
    try {
      certificate = new crypto.X509Certificate(fs.readFileSync(route.certificate));
      key = crypto.createPrivateKey(fs.readFileSync(route.key));
    } catch (_) {
      throw Error('Application alias certificate or private key is unavailable or invalid.');
    }
    requireValue(
      Date.parse(certificate.validFrom) <= Date.now() &&
        Date.parse(certificate.validTo) > Date.now(),
      'Application alias certificate is not currently valid.',
    );
    requireValue(
      certificate.checkPrivateKey(key),
      'Application alias certificate and private key do not match.',
    );
    for (const host of [...route.aliases, route.canonical])
      requireValue(
        certificate.checkHost(host, { subject: 'never' }),
        'Application certificate must cover the canonical host and every alias in its subject alternative names.',
      );
  }
}
export function validate(
  mainContent: string,
  projectContents: string[] = [],
  checkCertificates = false,
) {
  // Do not tighten historical routes when no application aliases are configured.
  if (
    !projectContents.some((content) =>
      /^\s*(?:export\s+)?(?:PROD|BETA|REVIEW)_ALIASES=/m.test(content),
    )
  )
    return [];
  const aliasKeys = new Set(prefixes.map((prefix) => prefix + '_ALIASES'));
  if (
    !projectContents.some((content) =>
      Object.values(routing.settings(content, aliasKeys)).some((value) => value.trim()),
    )
  )
    return [];
  const main = routing.settings(mainContent);
  const projects = projectContents.map((content) => routing.settings(content, keys));
  const selected: ApplicationRoute[] = [];
  projects.forEach((project, index) => {
    for (const prefix of prefixes) {
      const value = project[prefix + '_ALIASES']?.trim();
      if (!value) continue;
      requireValue(
        !managed(projectContents[index]) && project.PROJECT_TEMPLATE !== 'wizard',
        'Managed Wizard aliases are configured in General.',
      );
      if (project['USE_' + prefix + '_HOST'] !== 'true') {
        const disabled = value.split(/\s+/).map(routing.hostname);
        requireValue(
          disabled.length <= 100 && new Set(disabled).size === disabled.length,
          'Configure at most 100 distinct aliases per application environment.',
        );
        continue;
      }
      requireValue(
        ['0', '2'].includes(project[prefix + '_DOMAIN_MODE']),
        'Application aliases require an enabled exact canonical host in domain mode 0 or 2.',
      );
      const canonical = routing.hostname(project[prefix + '_HOST']);
      const aliases = value.split(/\s+/).map(routing.hostname);
      requireValue(
        aliases.length <= 100 && new Set(aliases).size === aliases.length,
        'Configure at most 100 distinct aliases per application environment.',
      );
      const certificate = certificatePath(project[prefix + '_SSL']),
        key = certificatePath(project[prefix + '_SSL_KEY']);
      requireValue(certificate !== key, 'Use distinct certificate and private-key files.');
      const reserved = (main.WIZARD_ALIASES || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(routing.hostname);
      for (const alias of aliases) {
        requireValue(alias !== canonical, 'An application alias cannot redirect to itself.');
        requireValue(
          !reserved.includes(alias),
          'An application alias conflicts with a Wizard alias.',
        );
        for (const platform of ['WIZARD', 'GITLAB', 'GITLAB_REGISTRY', 'SYNC'])
          requireValue(
            !routing.conflicts(alias, main[platform + '_HOST'], main[platform + '_DOMAIN_MODE']),
            'An application alias conflicts with a platform host.',
          );
        for (const other of projects)
          for (const environment of prefixes)
            if (other['USE_' + environment + '_HOST'] === 'true')
              requireValue(
                !routing.conflicts(
                  alias,
                  other[environment + '_HOST'],
                  other[environment + '_DOMAIN_MODE'],
                ),
                'An application alias conflicts with an enabled project host.',
              );
        requireValue(
          !selected.some((route) => route.aliases.includes(alias)),
          'Application aliases must have one environment owner.',
        );
      }
      selected.push({
        project: project.PROJECT_NAME,
        environment: prefix,
        canonical,
        aliases,
        certificate,
        key,
        origin: (project[prefix + '_DOMAIN_MODE'] === '2' ? 'https://' : 'http://') + canonical,
      });
    }
  });
  if (checkCertificates) certificates(selected);
  return selected;
}
export function imported(archive: string, current: string) {
  const main = path.join(
    fs.existsSync(path.join(archive, '.docker.env')) ? archive : current,
    '.docker.env',
  );
  let projects = routing.projectFiles(
    path.join(
      fs.existsSync(path.join(archive, '.projects.env')) ? archive : current,
      '.projects.env',
    ),
  );
  const owned = routing
    .projectFiles(path.join(current, '.projects.env'))
    .find((file) => file.name === '.wizard.env' && managed(file.content));
  if (owned) projects = projects.filter((file) => file.name !== owned.name).concat(owned);
  return { main: fs.existsSync(main) ? fs.readFileSync(main, 'utf8') : '', projects };
}
export function render(routes: ApplicationRoute[]) {
  return routes
    .map((route) =>
      routing
        .render(route)
        .replace('saved Wizard alias configuration', 'saved application alias configuration'),
    )
    .join('\n');
}
