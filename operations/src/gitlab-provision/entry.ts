#!/usr/bin/env node
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { GitlabProvisionModule } from './gitlab-provision.module';
import { GitlabCredentialService } from './credential.service';
function privateToken(filename: string): string {
  if (!path.isAbsolute(filename))
    throw Error('Absolute private administrator-token file required.');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.uid !== process.getuid?.() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > 4096
    )
      throw Error('Private administrator-token file must be owned and mode 0600.');
    const token = fs.readFileSync(fd, 'utf8').replace(/\r?\n$/, '');
    if (!token || /[\r\n\0]/.test(token)) throw Error('Invalid administrator-token file.');
    return token;
  } finally {
    fs.closeSync(fd);
  }
}
export async function main(args: string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'GitLab credentials: initialize|renew|reconcile-initial --checkout ABS [--config-directory ABS] [--username NAME --email ADDRESS] [--administrator-token-file ABS]. Run in the controller mount namespace; stdout contains metadata only.',
    );
    return;
  }
  const command = args[0],
    values: Record<string, string> = {};
  if (!['initialize', 'renew', 'reconcile-initial'].includes(command))
    throw Error('Unsupported GitLab credential action.');
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index],
      value = args[index + 1];
    if (
      ![
        '--checkout',
        '--config-directory',
        '--username',
        '--email',
        '--administrator-token-file',
      ].includes(key) ||
      !value ||
      value.startsWith('--') ||
      key in values
    )
      throw Error('Invalid GitLab credential arguments.');
    values[key] = value;
  }
  if (
    !values['--checkout'] ||
    !path.isAbsolute(values['--checkout']) ||
    Boolean(values['--username']) !== Boolean(values['--email']) ||
    (values['--username'] && command !== 'initialize') ||
    (command === 'initialize' && values['--administrator-token-file']) ||
    (command === 'reconcile-initial' && !values['--administrator-token-file'])
  )
    throw Error('Invalid GitLab credential arguments.');
  const administrator = values['--administrator-token-file']
    ? privateToken(values['--administrator-token-file'])
    : undefined;
  const abort = new AbortController(),
    cancel = () => abort.abort();
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  let app: INestApplicationContext | undefined;
  try {
    app = await NestFactory.createApplicationContext(GitlabProvisionModule, { logger: false });
    const service = app.get(GitlabCredentialService);
    const options = {
      checkout: values['--checkout'],
      configDirectory: values['--config-directory'],
      identity: values['--username']
        ? { username: values['--username'], email: values['--email'] }
        : undefined,
      signal: abort.signal,
    };
    const result =
      command === 'initialize'
        ? await service.ensure(options)
        : command === 'renew'
          ? await service.renew(options, administrator)
          : await service.reconcileInitial(options, administrator!);
    console.log(
      JSON.stringify({
        state: 'ready',
        account: result.account,
        tokenId: result.credential.id,
        expiresAt: result.credential.expiresAt,
      }),
    );
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await app?.close();
  }
}
if (require.main === module)
  void main(process.argv.slice(2)).catch(() => {
    console.error(
      'GitLab credential operation did not complete; retain its private journal and retry the matching documented recovery action.',
    );
    process.exitCode = 1;
  });
