import {
  environmentKinds,
  EnvironmentSettings,
  PlatformSettings,
  EnvironmentReservation,
  EnvironmentRequest,
} from './types';

export function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeSettings(
  input: unknown,
  platform: PlatformSettings = {},
): EnvironmentSettings {
  if (!object(input) || Object.keys(input).some((key) => key !== 'review' && key !== 'beta')) {
    throw new Error('Provide explicit Review and Beta environment settings.');
  }

  const setting = (name: 'review' | 'beta') => {
    const value = input[name];

    if (
      !object(value) ||
      Object.keys(value).some(
        (key) => !['enabled', 'host', 'domainMode', 'ssl', 'sslKey'].includes(key),
      ) ||
      typeof value.enabled !== 'boolean' ||
      value.domainMode !== 2 ||
      typeof value.host !== 'string' ||
      typeof value.ssl !== 'string' ||
      typeof value.sslKey !== 'string'
    ) {
      throw new Error(
        'Review and Beta require enabled, exact host, HTTPS domainMode 2, certificate and key settings.',
      );
    }

    const host = value.host.toLowerCase();

    if (
      (value.enabled || host) &&
      (host.length > 253 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host))
    ) {
      throw new Error('Configure an exact DNS hostname for each optional environment.');
    }

    const validPath = (file: string) =>
      /^\/ssl\/[A-Za-z0-9_./-]+$/.test(file) &&
      !file.split('/').includes('..') &&
      !file.endsWith('/');

    if (
      ((value.enabled || value.ssl) && !validPath(value.ssl)) ||
      ((value.enabled || value.sslKey) && !validPath(value.sslKey)) ||
      (value.ssl && value.ssl === value.sslKey)
    ) {
      throw new Error('Use distinct absolute certificate and key paths within /ssl.');
    }

    if (
      value.enabled &&
      Object.entries(platform).some(
        ([key, configured]) => key.endsWith('_HOST') && configured.toLowerCase() === host,
      )
    ) {
      throw new Error('An environment host conflicts with an existing platform service.');
    }

    return {
      enabled: value.enabled,
      host,
      domainMode: 2 as const,
      ssl: value.ssl,
      sslKey: value.sslKey,
    };
  };
  const selected = { review: setting('review'), beta: setting('beta') };

  if (
    selected.review.enabled &&
    selected.beta.enabled &&
    selected.review.host === selected.beta.host
  ) {
    throw new Error('Review and Beta must use different HTTPS hosts.');
  }

  return selected;
}

export function validateHostAssignments(
  selected: EnvironmentSettings,
  aliases: readonly string[],
  projects: readonly PlatformSettings[],
): void {
  for (const name of environmentKinds) {
    const value = selected[name];

    if (!value.enabled) {
      continue;
    }

    if (aliases.includes(value.host)) {
      throw new Error('An environment host conflicts with a configured Wizard alias.');
    }
  }
  for (const settings of projects) {
    for (const name of environmentKinds) {
      const value = selected[name];

      if (!value.enabled) {
        continue;
      }

      for (const environment of ['PROD', 'BETA', 'REVIEW']) {
        if (
          settings['USE_' + environment + '_HOST'] === 'true' &&
          settings[environment + '_HOST']?.toLowerCase() === value.host
        ) {
          throw new Error('An environment host is already assigned to another project.');
        }
      }
    }
  }
}

export function defaults(settings: PlatformSettings): EnvironmentSettings {
  const setting = (name: 'review' | 'beta') => {
    const host = name + '.' + (settings.WIZARD_HOST || '');
    return {
      enabled: false,
      host,
      domainMode: 2 as const,
      ssl: '/ssl/live/' + host + '/fullchain.pem',
      sslKey: '/ssl/live/' + host + '/privkey.pem',
    };
  };
  return { review: setting('review'), beta: setting('beta') };
}

export function hasDeployments(value: EnvironmentReservation | undefined): boolean {
  return environmentKinds.some(
    (name) => !!value?.deployments?.[name]?.active || !!value?.deployments?.[name]?.pending,
  );
}

export function validateRequestShape(input: unknown): asserts input is Record<string, unknown> {
  if (
    !object(input) ||
    Object.keys(input).some((key) => !['previewHash', 'settings'].includes(key))
  ) {
    throw new Error(
      'Confirm only previewHash and environment settings; helper identity is server-owned.',
    );
  }
}

export function parseEnvironmentRequest(input: unknown): EnvironmentRequest {
  validateRequestShape(input);
  const settings = normalizeSettings(input.settings);

  if (typeof input.previewHash !== 'string') {
    throw new Error('Fetch a fresh environment preview before confirmation.');
  }

  return { previewHash: input.previewHash, settings };
}
