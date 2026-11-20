#!/usr/bin/env node
import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { HostBootstrapModule } from './host-bootstrap.module';
import { BuildToolsService } from './build-tools.service';
export async function main(args: string[], env = process.env): Promise<void> {
  const [command, flag, checkout] = args;
  if (
    !['refresh-ca', 'install-runtime'].includes(command) ||
    flag !== '--checkout' ||
    !checkout ||
    !path.isAbsolute(checkout) ||
    args.length !== 3
  )
    throw Error('Use refresh-ca or install-runtime --checkout ABSOLUTE_CHECKOUT.');
  const app = await NestFactory.createApplicationContext(HostBootstrapModule, {
    logger: false,
    abortOnError: false,
  });
  const abort = new AbortController(),
    cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    const service = app.get(BuildToolsService);
    if (command === 'refresh-ca') service.refreshCa(checkout);
    else await service.installRuntime(checkout, env, abort.signal);
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await app.close();
  }
}
if (require.main === module)
  void main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
