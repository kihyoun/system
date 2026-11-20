#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWelcome } from './cli/presentation';

function packageVersion(): string {
  const metadata: unknown = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string'
  )
    throw new Error('package-version-unavailable');
  return metadata.version;
}

export function parseHostArguments(args: readonly string[]) {
  let checkout = '',
    image = '',
    persistenceEnv = '/etc/system-bootstrapper/persistence.env';
  let configurationBackup: string | undefined,
    checkOnly = false;
  const forward: string[] = [];
  const install = args[0] === 'install';
  const accepted = install
    ? ['--checkout', '--controller', '--wizard', '--persistence-env', '--release-metadata']
    : ['--checkout', '--image', '--persistence-env', '--configuration-backup'];
  const seen = new Set<string>();
  for (let index = 1; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error('duplicate-option');
    seen.add(flag);
    if (!install && flag === '--check-only') {
      checkOnly = true;
      continue;
    }
    if (install && flag === '--install-host') {
      forward.push(flag);
      continue;
    }
    if (!accepted.includes(flag) || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error('unknown-command-use-help');
    const value = args[++index];
    if (flag === '--checkout') checkout = value;
    else if (install) forward.push(flag, value);
    else if (flag === '--image') image = value;
    else if (flag === '--persistence-env') persistenceEnv = value;
    else configurationBackup = value;
  }
  if (!checkout.startsWith('/')) throw new Error('explicit-host-checkout-required');
  if (!install && !image) throw new Error('accepted-controller-image-required');
  if (
    !persistenceEnv.startsWith('/') ||
    (configurationBackup && !configurationBackup.startsWith('/'))
  )
    throw new Error('absolute-private-input-required');
  return { checkout, image, persistenceEnv, configurationBackup, checkOnly, forward };
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (args.length === 0) {
    process.stdout.write(renderWelcome(packageVersion()));
    return;
  }
  if (args.length === 1 && args[0] === '--version') {
    process.stdout.write(`${packageVersion()}\n`);
    return;
  }
  if (args.length === 1 && ['--help', 'help', '-h'].includes(args[0])) {
    process.stdout.write(
      'System Bootstrapper\n\nUsage: system-bootstrapper <command>\n\n' +
        '  install             Install an accepted image pair on a fresh host\n' +
        '  harvest             Save persistent data to the configured Seed destination\n' +
        '  restore             Restore the configured completed Seed into fresh storage\n' +
        '  --version           Print the installed CLI version\n' +
        '  --help              Show this help\n\n' +
        '  start / stop        Start or stop the host platform\n' +
        '  persistence         Verify and prepare selected persistent storage\n\n' +
        'Host commands require --checkout /absolute/reviewed/source.\n' +
        'Storage: --image IMAGE --persistence-env FILE [--check-only] [--configuration-backup ZIP]\n' +
        'Install: --controller IMAGE@sha256:DIGEST --wizard IMAGE@sha256:DIGEST [--release-metadata FILE] [--install-host]\n',
    );
    return;
  }
  if (['start', 'stop', 'persistence'].includes(args[0])) {
    if (args.length !== 3 || args[1] !== '--checkout' || !args[2].startsWith('/'))
      throw new Error('explicit-host-checkout-required');
    const { hostLifecycle } = await import('./host-lifecycle/entry.js');
    await hostLifecycle(args[0], args[2]);
    return;
  }
  if (['harvest', 'restore', 'install'].includes(args[0])) {
    const options = parseHostArguments(args);
    const { NestFactory } = await import('@nestjs/core');
    const { HostModule, HostStorageService, HostInstallService, installArguments } =
      await import('./host/index.js');
    const application = await NestFactory.createApplicationContext(HostModule.register(), {
      logger: false,
    });
    try {
      if (args[0] === 'install') {
        application
          .get(HostInstallService)
          .install(installArguments(options.forward), options.checkout);
      } else {
        await application.get(HostStorageService).execute({
          operation: args[0] as 'harvest' | 'restore',
          checkout: options.checkout,
          image: options.image,
          persistenceEnv: options.persistenceEnv,
          configurationBackup: options.configurationBackup,
          checkOnly: options.checkOnly,
        });
      }
    } finally {
      await application.close();
    }
    return;
  }
  throw new Error('unknown-command-use-help');
}

if (require.main === module)
  main().catch((error: unknown) => {
    const message =
      error instanceof Error && /^[a-z][a-z0-9-]+$/.test(error.message)
        ? error.message
        : 'operation-failed';
    process.stderr.write(`System Bootstrapper: ${message}\n`);
    process.exitCode = 1;
  });
