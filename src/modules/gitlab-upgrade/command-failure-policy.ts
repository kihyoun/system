import path from 'node:path';
import { selectControlledFailureCode } from '../../common/runtime/process';

export const upgradeCommandStages = [
  'preflight-sql',
  'preflight-configuration',
  'preflight-package',
  'preflight-identity',
  'preflight-private-files',
  'migration-status',
  'readiness-http',
  'service-control',
  'lifecycle',
  'routing',
  'checkpoint',
  'inspect',
  'native',
] as const;
export const upgradeCommandFailureKinds = [
  'nonzero-exit',
  'timeout',
  'signal',
  'spawn-not-found',
  'spawn-permission',
  'spawn-resource',
  'output-limit',
  'native-error',
] as const;
export type UpgradeCommandStage = (typeof upgradeCommandStages)[number];
export type UpgradeCommandFailureKind = (typeof upgradeCommandFailureKinds)[number];
export const upgradeCommandFailureCodes: readonly string[] = Object.freeze(
  upgradeCommandStages.flatMap((stage) =>
    upgradeCommandFailureKinds.map((kind) => `upgrade-command-${stage}-${kind}`),
  ),
);
export const workerFailureMarker = 'SYSTEM_GITLAB_UPGRADE_COMMAND_FAILURE ';
const spawnCodes = [
  'ENOENT',
  'EACCES',
  'EPERM',
  'EAGAIN',
  'ENOMEM',
  'EMFILE',
  'ENFILE',
  'ENOBUFS',
  'ETIMEDOUT',
] as const;
const signals = [
  'SIGHUP',
  'SIGINT',
  'SIGQUIT',
  'SIGILL',
  'SIGABRT',
  'SIGFPE',
  'SIGKILL',
  'SIGSEGV',
  'SIGPIPE',
  'SIGTERM',
  'SIGBUS',
  'SIGXCPU',
  'SIGXFSZ',
] as const;
export interface UpgradeNativeFailureFacts {
  kind: UpgradeCommandFailureKind;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  systemCode?: (typeof spawnCodes)[number];
}

export function nativeFailureFacts(
  error: unknown,
  status: number | null,
  signal: NodeJS.Signals | null,
): UpgradeNativeFailureFacts {
  const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const systemCode = spawnCodes.find((code) => code === rawCode);
  const kind: UpgradeCommandFailureKind = error
    ? systemCode === 'ETIMEDOUT'
      ? 'timeout'
      : systemCode === 'ENOBUFS'
        ? 'output-limit'
        : systemCode === 'ENOENT'
          ? 'spawn-not-found'
          : systemCode === 'EACCES' || systemCode === 'EPERM'
            ? 'spawn-permission'
            : systemCode && ['EAGAIN', 'ENOMEM', 'EMFILE', 'ENFILE'].includes(systemCode)
              ? 'spawn-resource'
              : 'native-error'
    : signal
      ? 'signal'
      : 'nonzero-exit';
  return {
    kind,
    exitCode: Number.isInteger(status) ? status : null,
    signal: signals.find((known) => known === signal) ?? null,
    ...(systemCode ? { systemCode } : {}),
  };
}

export function failureMarker(facts: UpgradeNativeFailureFacts): string {
  return workerFailureMarker + (facts.systemCode ?? facts.signal ?? facts.kind);
}

export function workerFailureFacts(
  stdout: string,
  stderr: string,
): UpgradeNativeFailureFacts | undefined {
  const options: UpgradeNativeFailureFacts[] = [
    ...upgradeCommandFailureKinds.map((kind) => ({ kind, exitCode: null, signal: null })),
    ...spawnCodes.map((code) => nativeFailureFacts({ code }, null, null)),
    ...signals.map((signal) => nativeFailureFacts(undefined, null, signal)),
  ];
  const markers = Object.fromEntries(
    options.map((facts, index) => [failureMarker(facts), 'failure-' + index]),
  );
  const matched = selectControlledFailureCode(stdout, stderr, markers);
  return matched ? options[Number(matched.slice('failure-'.length))] : undefined;
}

/** Classify only source-owned executable/option positions, never SQL or output. */
export function upgradeCommandStage(binary: string, args: string[]): UpgradeCommandStage {
  const name = path.basename(binary);
  if (name === 'rsync' || name === 'du') return 'checkpoint';
  if (binary === process.execPath && args[0] === path.resolve(__dirname, '../../cli/main.js')) {
    if (args[1] === 'lifecycle') return 'lifecycle';
    if (args[1] === 'projects-routing') return 'routing';
  }
  if (name !== 'docker') return 'native';
  const command = args[0] === '--host=unix:///var/run/docker.sock' ? args.slice(1) : args;
  if (
    ['inspect', 'ps'].includes(command[0]) ||
    (['image', 'volume'].includes(command[0]) && command[1] === 'inspect')
  )
    return 'inspect';
  if (['start', 'stop'].includes(command[0])) return 'service-control';
  if (command[0] !== 'exec') return 'native';
  let index = 1;
  while (['-i', '-t', '--user', '-u', '--env', '-e'].includes(command[index])) {
    index += ['--user', '-u', '--env', '-e'].includes(command[index]) ? 2 : 1;
  }
  let executable = command[++index];
  if (executable === 'env') {
    index++;
    if (command[index] === '-i') index++;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(command[index] ?? '')) index++;
    executable = command[index];
  }
  if (executable === 'timeout') {
    index++;
    if (command[index] === '-k') index += 2;
    index++;
    executable = command[index];
  }
  if (executable === '/opt/gitlab/embedded/bin/psql') return 'preflight-sql';
  if (executable === 'dpkg-query') return 'preflight-package';
  if (
    executable === 'cat' &&
    ['/var/opt/gitlab/gitlab-rails/etc/database.yml', '/opt/gitlab/etc/gitlab-rails-rc'].includes(
      command[index + 1],
    )
  )
    return 'preflight-configuration';
  if (
    executable === 'id' ||
    (executable === 'cat' &&
      command[index + 1] === '/opt/gitlab/embedded/service/gitlab-rails/VERSION')
  )
    return 'preflight-identity';
  if (['mktemp', 'install', 'dd', 'chown', 'rm'].includes(executable))
    return 'preflight-private-files';
  if (executable === 'gitlab-rake' && command[index + 1] === 'db:migrate:status')
    return 'migration-status';
  if (
    executable === 'curl' &&
    command.some((value) =>
      ['http://127.0.0.1/-/readiness', 'http://127.0.0.1/-/readiness?all=1'].includes(value),
    )
  )
    return 'readiness-http';
  if (
    executable === 'gitlab-ctl' ||
    executable === '/opt/gitlab/embedded/bin/sv' ||
    (executable === 'find' && command[index + 1] === '/opt/gitlab/service')
  )
    return 'service-control';
  return 'native';
}
