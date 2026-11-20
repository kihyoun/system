#!/usr/bin/env node
import 'reflect-metadata';
import path from 'node:path';
import { UbuntuHostService } from './ubuntu.service';
import { RetainedRecoveryService } from './recovery.service';
import { NestFactory } from '@nestjs/core';
import { HostBootstrapModule } from './host-bootstrap.module';
import { BuildToolsService } from './build-tools.service';
import { HostCertificateService } from './certificate.service';
import { LocalHostService } from './local.service';
export async function main(input: string[], env = process.env): Promise<void> {
  const args = [...input],
    command = args.shift();
  const index = args.indexOf('--checkout'),
    checkout = index >= 0 ? args[index + 1] : undefined;
  if (index >= 0) args.splice(index, 2);
  if (!command || !checkout || !path.isAbsolute(checkout))
    throw Error('An explicit absolute --checkout is required.');
  if (
    ![
      'install-host',
      'recover-volume',
      'refresh-ca',
      'install-runtime',
      'install-volume-host',
      'install-certificate',
      'certbot',
      'prepare-local',
    ].includes(command)
  )
    throw Error('Unsupported host bootstrap action.');
  if (
    command !== 'certbot' &&
    !(command === 'recover-volume' && args.length === 1 && args[0] === '--verify') &&
    args.length
  )
    throw Error('Unexpected host bootstrap arguments.');
  if (command !== 'refresh-ca' && process.geteuid?.() !== 0)
    throw Error('Host bootstrap requires root.');
  const app = await NestFactory.createApplicationContext(HostBootstrapModule, {
    logger: false,
    abortOnError: false,
  });
  const abort = new AbortController(),
    cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    if (command === 'install-host') await app.get(UbuntuHostService).install(env, abort.signal);
    else if (command === 'recover-volume')
      await app
        .get(RetainedRecoveryService)
        .recover(checkout, env, args[0] === '--verify', abort.signal);
    else if (command === 'refresh-ca') app.get(BuildToolsService).refreshCa(checkout);
    else if (command === 'install-runtime')
      await app.get(BuildToolsService).installRuntime(checkout, env, abort.signal);
    else if (command === 'prepare-local')
      await app.get(LocalHostService).prepare(env, abort.signal);
    else {
      const service = app.get(HostCertificateService);
      if (command === 'install-volume-host') await service.install(checkout, env, abort.signal);
      else if (command === 'install-certificate')
        await service.publish(checkout, env, abort.signal);
      else
        await service.renew(checkout, args[0] === '--' ? args.slice(1) : args, env, abort.signal);
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
    console.error(error.message);
    process.exitCode = 1;
  });
}
