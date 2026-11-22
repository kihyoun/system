#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderWelcome } from './presentation';
import { applicationCommand } from './applicationCommands';

function packageVersion(): string {
  const metadata: unknown = JSON.parse(
    readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
  );

  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('version' in metadata) ||
    typeof metadata.version !== 'string'
  ) {
    throw new Error('package-version-unavailable');
  }

  return metadata.version;
}

export function parseHostArguments(
  args: readonly string[],
  defaults?: { checkout: string; image?: string; persistenceEnv?: string },
) {
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

    if (seen.has(flag)) {
      throw new Error('duplicate-option');
    }

    seen.add(flag);

    if (!install && flag === '--check-only') {
      checkOnly = true;
      continue;
    }

    if (install && flag === '--install-host') {
      forward.push(flag);
      continue;
    }

    if (!accepted.includes(flag) || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('unknown-command-use-help');
    }

    const value = args[++index];

    if (flag === '--checkout') {
      checkout = value;
    } else if (install) {
      forward.push(flag, value);
    } else if (flag === '--image') {
      image = value;
    } else if (flag === '--persistence-env') {
      persistenceEnv = value;
    } else {
      configurationBackup = value;
    }
  }
  checkout ||= defaults?.checkout || '';
  image ||= defaults?.image || '';

  if (!seen.has('--persistence-env') && defaults?.persistenceEnv) {
    persistenceEnv = defaults.persistenceEnv;
  }

  if (!checkout.startsWith('/')) {
    throw new Error('explicit-host-checkout-required');
  }

  if (!install && !image) {
    throw new Error('accepted-controller-image-required');
  }

  if (
    !persistenceEnv.startsWith('/') ||
    (configurationBackup && !configurationBackup.startsWith('/'))
  ) {
    throw new Error('absolute-private-input-required');
  }

  return { checkout, image, persistenceEnv, configurationBackup, checkOnly, forward };
}

export async function resolveHostArguments(
  args: readonly string[],
  resolve = async (storage: boolean) => (await import('./installation.js')).installedHost(storage),
): Promise<readonly string[]> {
  const command = args[0],
    storage = ['harvest', 'restore'].includes(command);
  const lifecycle = ['start', 'stop', 'persistence'].includes(command);
  const advanced = [
    'controller-update',
    'upgrade',
    'recovery',
    'promote',
    'gitlab-upgrade',
    'recovery-export',
    'promotion-abort',
  ].includes(command);

  if (!storage && !lifecycle && !advanced) {
    return args;
  }

  if (storage) {
    parseHostArguments(args, { checkout: '/selected-installation', image: 'selected-image' });
  }

  if (
    lifecycle &&
    !(
      args.length === 1 ||
      (args.length === 3 && args[1] === '--checkout' && args[2].startsWith('/'))
    )
  ) {
    throw Error('explicit-host-checkout-required');
  }

  if (args.includes('--checkout')) {
    return args;
  }

  const selected = await resolve(storage && !args.includes('--image'));
  const result = [...args, '--checkout', selected.checkout];

  if (storage && !args.includes('--image')) {
    if (!selected.image) {
      throw Error('cli-saved-controller-image-required');
    }

    result.push('--image', selected.image);
  }

  const persistence = storage || (advanced && command !== 'recovery');

  if (persistence) {
    const supplied = args.indexOf('--persistence-env');

    if (supplied >= 0 && args[supplied + 1] !== selected.persistenceEnv) {
      throw Error('cli-installation-selector-mismatch');
    }

    if (supplied < 0) {
      result.push('--persistence-env', selected.persistenceEnv);
    }
  }

  if (lifecycle) {
    process.env.PERSISTENCE_ENV_FILE = selected.persistenceEnv;
  }

  return result;
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
        '  cli-install         Register this verified CLI and an optional installed checkout\n' +
        '  harvest             Save persistent data to the configured Seed destination\n' +
        '  restore             Restore the configured completed Seed into fresh storage\n' +
        '  --version           Print the installed CLI version\n' +
        '  --help              Show this help\n\n' +
        '  start / stop        Start or stop the host platform\n' +
        '  persistence         Verify and prepare selected persistent storage\n\n' +
        '  promotion-abort     Recover an interrupted promotion from its retained checkpoint\n\n' +
        '  promote             Promote or inspect an accepted controller successor\n' +
        '  gitlab-upgrade      Prepare, migrate or recover the declared GitLab prerequisite\n' +
        '  controller-update   Update or recover an accepted controller/Wizard pair\n' +
        '  upgrade             Plan, apply or recover an official public release upgrade\n\n' +
        '  recovery-export     Retain the accepted running controller image and source\n' +
        '  recovery            Verify or load retained accepted recovery archives\n' +
        '  gitlab-credentials  Initialize or recover the private automation credential\n\n' +
        '  api                 Run the authenticated Sync HTTP application\n' +
        '  host-bootstrap      Prepare and inspect the host runtime\n' +
        '  lifecycle / storage Run shared controller and storage operations\n' +
        '  configuration       Apply verified configuration through shared services\n' +
        '  projects-routing    Validate and apply owned routing\n' +
        '  project-environments / system-beta / wizard-production\n' +
        '                      Operate explicitly selected project environments\n' +
        '  project-ci          Build, verify and operate source-bound project CI\n' +
        '  wizard-environments preview|status|configure REQUEST_FILE|preflight SETTINGS_FILE|inspect\n' +
        '  source-checkout / source-prepare / wizard-source-primary / wizard-upgrade\n' +
        '                      Prepare and maintain managed project sources\n' +
        '  release / renovate  Run explicitly authorized publication and dependency operations\n' +
        '  ci / docs / resources\n' +
        '                      Repository build, verification and authoring capabilities\n\n' +
        'Host commands use the registered installation; --checkout explicitly selects a recovery/development checkout.\n' +
        'CLI setup: cli-install --checkout /root-owned/installed/source [--persistence-env FILE]\n' +
        'Offline CLI setup: cli-install --runtime /absolute/accepted/runtime [--checkout /root-owned/installed/source] [--persistence-env FILE]\n' +
        'The selected runtime retains accepted-release.json and accepted-cli.tgz. Explicit verified inputs: --release-metadata FILE --artifact FILE\n' +
        'Storage uses its saved controller image and persistence selector. Overrides: --image IMAGE --persistence-env FILE [--check-only] [--configuration-backup ZIP]\n' +
        'Install: --checkout /absolute/reviewed/source --controller IMAGE@sha256:DIGEST --wizard IMAGE@sha256:DIGEST [--release-metadata FILE] [--install-host]\n',
    );
    return;
  }

  if (args[0] === 'cli-install') {
    const { withCliInstallation, installCli } = await import('./installation.js');
    await withCliInstallation((service) => installCli(service, [...args.slice(1)]));
    console.log('System Bootstrapper command installed.');
    return;
  }

  if (await applicationCommand(args[0], [...args.slice(1)])) {
    return;
  }

  args = await resolveHostArguments(args);

  if (['controller-update', 'upgrade', 'recovery', 'promote', 'gitlab-upgrade'].includes(args[0])) {
    const checkout = args.indexOf('--checkout');

    if (checkout < 1 || !args[checkout + 1]?.startsWith('/')) {
      throw new Error('explicit-host-checkout-required');
    }

    if (args[0] === 'gitlab-upgrade') {
      const { publicGitlabMain } = await import('../modules/host/publicGitlabPrerequisiteEntry.js');
      await publicGitlabMain([...args.slice(1)]);
    } else if (args[0] === 'promote') {
      const { promotionMain } = await import('../modules/host/promotionEntry.js');
      await promotionMain([...args.slice(1)]);
    } else if (args[0] === 'controller-update') {
      const { pairedControllerMain } = await import('../modules/host/pairedControllerEntry.js');
      await pairedControllerMain([...args.slice(1)]);
    } else if (args[0] === 'upgrade') {
      const { publicUpgradeMain } = await import('../modules/host/publicUpgradeEntry.js');
      await publicUpgradeMain([...args.slice(1)]);
    } else {
      const { recoveryMain } = await import('../modules/host/recoveryEntry.js');
      await recoveryMain([...args.slice(1)]);
    }

    return;
  }

  if (args[0] === 'recovery-export') {
    const checkout = args.indexOf('--checkout');

    if (checkout < 1 || !args[checkout + 1]?.startsWith('/')) {
      throw new Error('explicit-host-checkout-required');
    }

    const { recoveryExportMain } = await import('../modules/host/recoveryExportEntry.js');
    await recoveryExportMain([...args.slice(1)]);
    return;
  }

  if (args[0] === 'gitlab-credentials') {
    const { main: credentials } = await import('../modules/gitlab-provision/entry.js');
    await credentials([...args.slice(1)]);
    return;
  }

  if (args[0] === 'promotion-abort') {
    const checkout = args.indexOf('--checkout');

    if (checkout < 1 || !args[checkout + 1]?.startsWith('/')) {
      throw new Error('explicit-host-checkout-required');
    }

    const { main: recover } = await import('../modules/host/promotionRecoveryEntry.js');
    await recover([...args.slice(1)]);
    return;
  }

  if (['start', 'stop', 'persistence'].includes(args[0])) {
    if (args.length !== 3 || args[1] !== '--checkout' || !args[2].startsWith('/')) {
      throw new Error('explicit-host-checkout-required');
    }

    const { hostLifecycle } = await import('../modules/host-lifecycle/entry.js');
    await hostLifecycle(args[0], args[2]);
    return;
  }

  if (['harvest', 'restore', 'install'].includes(args[0])) {
    const options = parseHostArguments(args);
    const { NestFactory: nestFactory } = await import('@nestjs/core');
    const {
      HostModule: hostModule,
      HostStorageService: hostStorageService,
      HostInstallService: hostInstallService,
      installArguments,
    } = await import('../modules/host/index.js');
    const application = await nestFactory.createApplicationContext(hostModule.register(), {
      logger: false,
    });
    try {
      if (args[0] === 'install') {
        application
          .get(hostInstallService)
          .install(installArguments(options.forward), options.checkout);
      } else {
        await application.get(hostStorageService).execute({
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

if (require.main === module) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error && /^[a-z][a-z0-9-]+$/.test(error.message)
        ? error.message
        : 'operation-failed';
    process.stderr.write(`System Bootstrapper: ${message}\n`);
    process.exitCode ||= 1;
  });
}
