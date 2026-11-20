export interface SourceSelection {
  mode: 'existing' | 'import';
  project: string;
  origin: string;
}
export interface PreviewEnvironment {
  enabled: boolean;
  host: string;
  ssl: string;
  sslKey: string;
}
export interface PreviewSettings {
  version: 1 | 2;
  namespace: string;
  wizard: SourceSelection;
  system?: SourceSelection;
  review: PreviewEnvironment;
  beta: PreviewEnvironment;
}
function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

// Portable intent only. Instance IDs, credentials and evidence never belong here.
export function settings(input: unknown): PreviewSettings {
  if (
    !object(input, ['version', 'namespace', 'wizard', 'system', 'review', 'beta']) ||
    (input.version !== 1 && input.version !== 2) ||
    typeof input.namespace !== 'string' ||
    !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(input.namespace || '') ||
    input.namespace.split('/').some((part) => ['.', '..'].includes(part))
  )
    throw Error('Select a namespace and versioned desired preview settings.');
  const project = (value: unknown): SourceSelection => {
    if (
      !object(value, ['mode', 'project', 'origin']) ||
      (value.mode !== 'existing' && value.mode !== 'import') ||
      typeof value.project !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value.project || '') ||
      value.project.endsWith('.git')
    )
      throw Error('Select an exact source project and import mode.');
    let origin = '';
    if (value.mode === 'import') {
      let url;
      try {
        url = new URL(typeof value.origin === 'string' ? value.origin : '');
      } catch (_) {
        throw Error('Use an explicit public HTTPS source or fork origin.');
      }
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.port ||
        !url.pathname.endsWith('.git') ||
        !url.hostname.includes('.') ||
        /^(?:localhost|127\.|0\.|169\.254\.|10\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.)/.test(
          url.hostname,
        )
      )
        throw Error(
          'Use a public HTTPS Git origin without credentials or redirects. Import private sources separately and select the existing project.',
        );
      origin = url.href;
    } else if (value.origin)
      throw Error('An existing source project does not accept a replacement origin.');
    return { mode: value.mode, project: value.project, origin };
  };
  const environment = (value: unknown): PreviewEnvironment => {
    if (
      !object(value, ['enabled', 'host', 'ssl', 'sslKey']) ||
      typeof value.enabled !== 'boolean' ||
      typeof value.host !== 'string' ||
      typeof value.ssl !== 'string' ||
      typeof value.sslKey !== 'string' ||
      ![value.host, value.ssl, value.sslKey].every((item) => item.length <= 1024)
    )
      throw Error('Provide explicit HTTPS hosts and certificate paths.');
    const host = value.host.toLowerCase();
    if (
      value.enabled &&
      (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) ||
        host.includes('..') ||
        !host.includes('.') ||
        ![value.ssl, value.sslKey].every(
          (item) => /^\/ssl\/[A-Za-z0-9_./-]+$/.test(item) && !item.split('/').includes('..'),
        ))
    )
      throw Error('Use exact HTTPS hosts and certificate/key paths within /ssl.');
    return { enabled: value.enabled, host, ssl: value.ssl, sslKey: value.sslKey };
  };
  const result: PreviewSettings = {
    version: input.version,
    namespace: input.namespace,
    wizard: project(input.wizard),
    ...(input.system ? { system: project(input.system) } : {}),
    review: environment(input.review),
    beta: environment(input.beta),
  };
  if (result.version === 2) {
    if (result.review.enabled || result.system || result.wizard.mode !== 'existing')
      throw Error(
        'Select the existing shared System project. System Review is retired; retained old settings require explicit migration.',
      );
    return result;
  }
  if (
    !result.review.enabled ||
    (result.beta.enabled && result.review.host === result.beta.host) ||
    result.system?.project === result.wizard.project
  )
    throw Error(
      'Enable a unique Review host and select distinct source projects. Beta is optional.',
    );
  return result;
}
