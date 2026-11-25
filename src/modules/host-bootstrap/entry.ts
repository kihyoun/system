#!/usr/bin/env node
import { HostInspectionService } from './inspection.service';
import { inspectHost } from './inspectionCli';
import 'reflect-metadata';
import path from 'node:path';
import { RuntimeVerificationService } from './runtimeVerification.service';
import { HostInitializeService } from './initialize.service';
import { parseArguments, absolute, optionalString } from './arguments';
import { QuickstartService } from './quickstart.service';
import { UbuntuHostService } from './ubuntu.service';
import { RetainedRecoveryService } from './recovery.service';
import { NestFactory } from '@nestjs/core';
import { HostBootstrapModule } from './hostBootstrap.module';
import { BuildToolsService } from './buildTools.service';
import { HostCertificateService } from './certificate.service';
import { LocalHostService } from './local.service';
import { CaVerificationService } from './caVerification.service';
export async function main(input: string[], env = process.env): Promise<void> {
  if (input.includes('--help') || input.includes('-h')) {
    console.log(
      'Host bootstrap: container-preflight --mongodb-version X.Y.Z [--image DIGEST] [--timeout 1..120] [--planned-kernel X.Y.Z]; log-policy [--max-size 10m] [--max-files 3] [CONTAINERS]; initialize --checkout ABS --receipt-dir ABS [--install-host] [--swap-gib 0..32] [--timeout 0..3600] [--renewal-dry-run]; verify-runtime --checkout ABS baseline|check --persistence-env ABS --output ABS [--baseline ABS] [--public-images] [--timeout SECONDS] [--gitlab-token-file ABS] [--redirect-from ORIGIN]',
    );
    return;
  }

  const args = [...input],
    command = args.shift();
  const index = args.indexOf('--checkout'),
    checkout = index >= 0 ? args[index + 1] : undefined;

  if (index >= 0) {
    args.splice(index, 2);
  }

  if (!command || !checkout || !path.isAbsolute(checkout)) {
    throw Error('host-bootstrap-absolute-checkout-required');
  }

  if (
    ![
      'rebind-renewal',
      'container-preflight',
      'log-policy',
      'initialize',
      'verify-runtime',
      'quickstart',
      'install-host',
      'recover-volume',
      'refresh-ca',
      'ca-check',
      'install-runtime',
      'install-volume-host',
      'install-certificate',
      'certbot',
      'prepare-local',
    ].includes(command)
  ) {
    throw Error('host-bootstrap-unsupported-action');
  }

  if (
    command !== 'rebind-renewal' &&
    command !== 'container-preflight' &&
    command !== 'log-policy' &&
    command !== 'certbot' &&
    command !== 'initialize' &&
    command !== 'verify-runtime' &&
    !(command === 'ca-check' && (!args.length || (args.length === 1 && args[0] === '--bundle'))) &&
    !(
      command === 'quickstart' &&
      args.length === 2 &&
      args[0] === '--metadata' &&
      path.isAbsolute(args[1])
    ) &&
    !(command === 'recover-volume' && args.length === 1 && args[0] === '--verify') &&
    args.length
  ) {
    throw Error('host-bootstrap-unexpected-arguments');
  }

  if (
    !['refresh-ca', 'ca-check', 'container-preflight', 'log-policy'].includes(command) &&
    process.geteuid?.() !== 0
  ) {
    throw Error('host-bootstrap-root-required');
  }

  const app = await NestFactory.createApplicationContext(HostBootstrapModule, {
    logger: false,
    abortOnError: false,
  });
  const abort = new AbortController(),
    cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    if (command === 'container-preflight' || command === 'log-policy') {
      await inspectHost(app.get(HostInspectionService), command, args, env, abort.signal);
    } else if (command === 'initialize') {
      const values = parseArguments(
        args,
        ['--install-host', '--renewal-dry-run'],
        ['--receipt-dir', '--timeout', '--swap-gib', '--gitlab-token-file', '--redirect-from'],
      );
      await app.get(HostInitializeService).initialize(
        {
          checkout,
          receiptDir: absolute(values['--receipt-dir']),
          installHost: values['--install-host'] === true,
          renewalDryRun: values['--renewal-dry-run'] === true,
          timeout: values['--timeout'] === undefined ? undefined : Number(values['--timeout']),
          swapGiB: values['--swap-gib'] === undefined ? undefined : Number(values['--swap-gib']),
          tokenFile: optionalString(values['--gitlab-token-file']),
          redirectFrom: optionalString(values['--redirect-from']),
        },
        env,
        abort.signal,
      );
    } else if (command === 'verify-runtime') {
      const operation = args.shift();

      if (operation !== 'baseline' && operation !== 'check') {
        throw Error('Runtime verification requires baseline or check.');
      }

      const values = parseArguments(
        args,
        ['--public-images'],
        [
          '--persistence-env',
          '--output',
          '--baseline',
          '--timeout',
          '--gitlab-token-file',
          '--redirect-from',
        ],
      );
      await app.get(RuntimeVerificationService).execute(
        {
          operation,
          checkout,
          persistenceEnv: absolute(values['--persistence-env']),
          output: absolute(values['--output']),
          baseline: optionalString(values['--baseline']),
          timeout: values['--timeout'] === undefined ? undefined : Number(values['--timeout']),
          tokenFile: optionalString(values['--gitlab-token-file']),
          redirectFrom: optionalString(values['--redirect-from']),
          publicImages: values['--public-images'] === true,
        },
        env,
        abort.signal,
      );
    } else if (command === 'ca-check') {
      const service = app.get(CaVerificationService);
      console.log(
        JSON.stringify(
          args[0] === '--bundle' ? service.bundle(checkout) : service.system(checkout, env),
        ),
      );
    } else if (command === 'quickstart') {
      await app.get(QuickstartService).install(checkout, args[1], env, abort.signal);
    } else if (command === 'install-host') {
      await app.get(UbuntuHostService).install(env, abort.signal);
    } else if (command === 'recover-volume') {
      await app
        .get(RetainedRecoveryService)
        .recover(checkout, env, args[0] === '--verify', abort.signal);
    } else if (command === 'refresh-ca') {
      app.get(BuildToolsService).refreshCa(checkout);
    } else if (command === 'install-runtime') {
      await app.get(BuildToolsService).installRuntime(checkout, env, abort.signal);
    } else if (command === 'prepare-local') {
      await app.get(LocalHostService).prepare(env, abort.signal);
    } else {
      const service = app.get(HostCertificateService);

      if (command === 'rebind-renewal') {
        const values = parseArguments(args, [], ['--directory', '--webroot']);
        service.rebind(absolute(values['--directory']), absolute(values['--webroot']));
      } else if (command === 'install-volume-host') {
        await service.install(checkout, env, abort.signal);
      } else if (command === 'install-certificate') {
        await service.publish(checkout, env, abort.signal);
      } else {
        await service.renew(checkout, args[0] === '--' ? args.slice(1) : args, env, abort.signal);
      }
    }
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await app.close();
  }
}

if (require.main === module) {
  const alias = path.basename(process.argv[1]),
    commands: Record<string, string> = {
      'system-certbot': 'certbot',
      'system-install-certificate': 'install-certificate',
      'system-web': 'install-certificate',
    };
  const args = commands[alias]
    ? [commands[alias], '--checkout', path.resolve(__dirname, '../../..'), ...process.argv.slice(2)]
    : process.argv.slice(2);
  void main(args).catch((error) => {
    console.error(
      error instanceof SyntaxError || error instanceof TypeError
        ? 'Invalid host bootstrap input or runtime response.'
        : error.message,
    );
    process.exitCode = 1;
  });
}
