import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { candidateReference, deliveryIdentity } from './delivery-policy';
import { DeliverySession, DeliverySessionService } from './delivery-session.service';
interface Application {
  version: 2;
  key: string;
  environments: Record<string, { host: string }>;
}
function configuration(root: string): Application {
  const value: unknown = JSON.parse(
    fs.readFileSync(path.join(root, '.system-bootstrapper/application-v2.json'), 'utf8'),
  );
  const record = value as Partial<Application>;
  if (
    !record ||
    record.version !== 2 ||
    typeof record.key !== 'string' ||
    !/^[a-z0-9]+$/.test(record.key) ||
    !record.environments ||
    typeof record.environments !== 'object' ||
    Array.isArray(record.environments)
  )
    throw Error('Versioned application configuration required');
  for (const [kind, setting] of Object.entries(record.environments))
    if (
      !['review', 'beta', 'prod'].includes(kind) ||
      !setting ||
      typeof setting.host !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(setting.host)
    )
      throw Error('Invalid application environment');
  return record as Application;
}
function logOptions(env: NodeJS.ProcessEnv): string[] {
  const size = env.APP_LOG_MAX_SIZE || '10m',
    files = env.APP_LOG_MAX_FILES || '3';
  if (!/^[1-9][0-9]*[kKmMgG]$/.test(size) || !/^([1-9][0-9]?|100)$/.test(files))
    throw Error('Invalid application log limits');
  return [
    '--log-driver',
    'json-file',
    '--log-opt',
    'max-size=' + size,
    '--log-opt',
    'max-file=' + files,
  ];
}
@Injectable()
export class ApplicationService {
  constructor(private readonly sessions: DeliverySessionService) {}

  async run(
    root: string,
    action: string,
    kind: string | undefined,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<void> {
    if (
      !['build', 'verify', 'deploy', 'stop'].includes(action) ||
      (kind !== undefined && !['deploy', 'stop'].includes(action))
    )
      throw Error('Use application build|verify|deploy ENVIRONMENT|stop review');
    if (!path.isAbsolute(root)) throw Error('Absolute source directory required');
    const app = configuration(root),
      identity = deliveryIdentity(env),
      logs = logOptions(env);
    if (
      ['deploy', 'stop'].includes(action) &&
      (!kind ||
        !['review', 'beta', 'prod'].includes(kind) ||
        !app.environments[kind] ||
        (action === 'stop' && kind !== 'review'))
    )
      throw Error('Configured application environment required');
    const slug = kind === 'review' ? env.CI_COMMIT_REF_SLUG || '' : '';
    if (kind === 'review' && !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug))
      throw Error('Exact Review branch slug required');
    const ref =
      action === 'build' || action === 'stop'
        ? ''
        : candidateReference(env.APPLICATION_IMAGE_REF || '', identity);
    await this.sessions.use(root, env, identity, signal, async (session) => {
      if (action !== 'stop') await session.login();
      if (action === 'build') {
        const image = `${identity.registryImage}:app-${identity.source}-${identity.pipeline}-${identity.job}-${session.operation}`;
        await session.createBuilder();
        await session.buildImage(image, [
          'buildx',
          'build',
          '--builder',
          session.builder,
          '--load',
          '--provenance=false',
          '--label',
          'org.opencontainers.image.revision=' + identity.source,
          '-f',
          'Dockerfile',
          '-t',
          image,
          '.',
        ]);
        await session.run(['push', image], 300000);
        const rows = await session.run([
          'image',
          'inspect',
          '--format',
          '{{range .RepoDigests}}{{println .}}{{end}}',
          image,
        ]);
        const digest = candidateReference(
          rows
            .split(/\r?\n/)
            .find((value) => value.startsWith(identity.registryImage + '@sha256:')) || '',
          identity,
        );
        fs.writeFileSync(
          path.join(root, 'app-image.env'),
          'APPLICATION_IMAGE_REF=' + digest + '\n',
        );
        return;
      }
      if (action === 'verify') {
        await session.run(['pull', ref], 300000);
        const id = await session.createContainer(session.builder + '-smoke', [
          ...logs,
          '--network',
          'none',
          ref,
        ]);
        await session.run(['start', id]);
        let ready = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          signal?.throwIfAborted();
          try {
            const page = await session.run(
              ['exec', id, 'wget', '-q', '-O', '-', 'http://127.0.0.1/'],
              5000,
            );
            if (!page.includes(app.key)) throw Error('Application identity absent from page');
            ready = true;
            break;
          } catch (error) {
            if (signal?.aborted) throw error;
          }
          await delay(1000, undefined, { signal });
        }
        if (!ready) throw Error('Application HTTP identity check failed');
        return;
      }
      const name = app.key + '-' + kind + (kind === 'review' ? '-' + slug : ''),
        owner = identity.project + ':' + name;
      if (action === 'deploy') await session.run(['pull', ref], 300000);
      await this.removePrevious(session, name, owner);
      if (action === 'stop') return;
      const host = (kind === 'review' ? slug + '.' : '') + app.environments[kind!].host;
      const id = await session.createContainer(name, [
        '--label',
        'system-bootstrapper.application=' + owner,
        '--restart',
        'unless-stopped',
        ...logs,
        '--network',
        app.key + '_' + kind,
        '-e',
        'VIRTUAL_HOST=' + host,
        ref,
      ]);
      await session.run(['start', id]);
      // A successful deployment transfers the exact container to the persistent
      // application owner. Failed/uncertain creation remains in the job journal.
      session.resources.splice(
        session.resources.findIndex((resource) => resource.id === id),
        1,
      );
    });
  }

  private async removePrevious(
    session: DeliverySession,
    name: string,
    owner: string,
  ): Promise<void> {
    const listed = (
      await session.run([
        'container',
        'ls',
        '--all',
        '--filter',
        'name=^/' + name + '$',
        '--format',
        '{{.ID}}',
      ])
    ).trim();
    if (!listed) return;
    const row = (
      await session.run([
        'container',
        'inspect',
        '--format',
        '{{.Id}} {{index .Config.Labels "system-bootstrapper.application"}}',
        name,
      ])
    )
      .trim()
      .split(' ');
    if (!/^[a-f0-9]{64}$/.test(row[0]) || row[1] !== owner || row.length !== 2)
      throw Error(
        'Existing application container lacks exact ownership; explicit migration required',
      );
    await session.run(['stop', '--time', '10', row[0]], 20000);
    await session.run(['rm', row[0]], 15000);
  }
}
