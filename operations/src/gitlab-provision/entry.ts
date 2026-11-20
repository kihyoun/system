#!/usr/bin/env node
import { GitlabTokenMetadataService } from './token-metadata.service';
import 'reflect-metadata';
import { ProjectProvisionService } from './project-provision.service';
import { SourcePrimaryOperationService } from './source-primary-operation.service';
import { GitlabProjectCredentialService } from './project-credential.service';
import { readPrivateInput } from '../host/private-input';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { GitlabProvisionModule } from './gitlab-provision.module';
import { GitlabCredentialService } from './credential.service';
function privateToken(filename: string): string {
  if (!path.isAbsolute(filename))
    throw Error('Absolute private administrator-token file required.');
  const token = readPrivateInput(filename, 4096, { owner: process.getuid?.(), mode: 0o600 })
    .toString('utf8')
    .replace(/\r?\n$/, '');
  if (!token || /[\r\n\0]/.test(token)) throw Error('Invalid administrator-token file.');
  return token;
}
export async function main(args: string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'GitLab credentials: initialize|renew|reconcile-initial|renew-project --checkout ABS [--config-directory ABS] [--username NAME --email ADDRESS] [--administrator-token-file ABS] [--project-id ID --project-path GROUP/PROJECT]. Run in the controller mount namespace; stdout contains metadata only.',
    );
    return;
  }
  const command = args[0],
    values: Record<string, string> = {};
  if (
    !['initialize', 'renew', 'reconcile-initial', 'activate', 'project', 'renew-project', 'token-metadata'].includes(command)
  )
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
        '--project-id',
        '--project-path',
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
    (['initialize', 'activate', 'project', 'renew-project', 'token-metadata'].includes(command) &&
      values['--administrator-token-file']) ||
    (['activate', 'project'].includes(command) && values['--config-directory']) ||
    (command === 'reconcile-initial' && !values['--administrator-token-file']) ||
    (command === 'renew-project' &&
      (!/^[1-9][0-9]*$/.test(values['--project-id'] ?? '') || !values['--project-path'])) ||
    (command !== 'renew-project' && Boolean(values['--project-id'] || values['--project-path']))
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
    if (['activate', 'project', 'token-metadata'].includes(command)) {
      let input = Buffer.alloc(0);
      for await (const chunk of process.stdin) {
        input = Buffer.concat([input, Buffer.from(chunk)]);
        if (input.length > 2 * 1024 * 1024) throw Error('Activation input is too large.');
      }
      if (command === 'token-metadata') {
        const result = await app
          .get(GitlabTokenMetadataService)
          .status(
            values['--checkout'],
            JSON.parse(input.toString('utf8')),
            abort.signal,
            values['--config-directory'],
          );
        console.log(JSON.stringify(result));
        return;
      }
      const service =
        command === 'project'
          ? app.get(ProjectProvisionService)
          : app.get(SourcePrimaryOperationService);
      const result = await service.execute(
        values['--checkout'],
        JSON.parse(input.toString('utf8')),
        abort.signal,
      );
      console.log(JSON.stringify(result));
      return;
    }
    const service = app.get(GitlabCredentialService);
    const options = {
      checkout: values['--checkout'],
      configDirectory: values['--config-directory'],
      identity: values['--username']
        ? { username: values['--username'], email: values['--email'] }
        : undefined,
      signal: abort.signal,
    };
    if (command === 'renew-project') {
      const authority = await service.ensure(options);
      const token = await app
        .get(GitlabProjectCredentialService)
        .current(
          authority.context,
          authority.configDirectory,
          Number(values['--project-id']),
          values['--project-path'],
          authority.credential.token,
          new Date(),
          true,
        );
      console.log(
        JSON.stringify({
          state: 'ready',
          projectId: Number(values['--project-id']),
          projectPath: values['--project-path'],
          tokenId: token.id,
          expiresAt: token.expiresAt,
          accessLevel: 40,
        }),
      );
      return;
    }
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
