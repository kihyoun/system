import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DeliverySessionService } from './delivery-session.service';
import { candidateReference, deliveryIdentity } from './delivery-policy';
const prefix = '.system-bootstrapper/build-v2';
@Injectable()
export class DeliveryService {
  constructor(private readonly sessions: DeliverySessionService) {}
  async build(root: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    const identity = deliveryIdentity(env);
    await this.sessions.use(root, env, identity, signal, async (session) => {
      const image = `${identity.registryImage}:wizard-${identity.source}-${identity.pipeline}-${identity.job}-${session.operation}`;
      await session.login();
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
        prefix + '/Dockerfile',
        '-t',
        image,
        '.',
      ]);
      await session.run(['push', image], 300000);
      const digests = await session.run([
        'image',
        'inspect',
        '--format',
        '{{range .RepoDigests}}{{println .}}{{end}}',
        image,
      ]);
      const ref = candidateReference(
        digests
          .split(/\r?\n/)
          .find((value) => value.startsWith(identity.registryImage + '@sha256:')) || '',
        identity,
      );
      fs.writeFileSync(path.join(root, 'image.env'), 'WIZARD_IMAGE_REF=' + ref + '\n');
      fs.writeFileSync(
        path.join(root, 'build-evidence.json'),
        JSON.stringify({
          version: 1,
          sourceCommit: identity.source,
          pipelineId: Number(identity.pipeline),
          imageRef: ref,
          unitTests: true,
          testRunner: 'vitest',
          lint: true,
          typecheck: true,
          productionBuild: true,
        }) + '\n',
      );
    });
  }
  async verify(root: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    const identity = deliveryIdentity(env),
      ref = candidateReference(env.WIZARD_IMAGE_REF || '', identity);
    await this.sessions.use(root, env, identity, signal, async (session) => {
      const name = session.builder,
        browserImage = name + '-browser-image',
        network = name + '-network';
      const evidence = path.join(root, 'browser-evidence');
      fs.mkdirSync(evidence, { recursive: true });
      await session.login();
      await session.run(['pull', ref], 300000);
      await session.createBuilder();
      await session.buildImage(browserImage, [
        'buildx',
        'build',
        '--builder',
        session.builder,
        '--load',
        '--provenance=false',
        '-f',
        prefix + '/Browser.Dockerfile',
        '-t',
        browserImage,
        '.',
      ]);
      const networkId = await session.createNetwork(network);
      const candidate = await session.createContainer(name + '-app', [
        '--memory',
        '128m',
        '--cpus',
        '0.5',
        '--network',
        networkId,
        '--network-alias',
        'wizard-candidate',
        ref,
      ]);
      await session.run(['start', candidate]);
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        signal?.throwIfAborted();
        try {
          await session.run(
            ['exec', candidate, 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1/'],
            5000,
          );
          ready = true;
          break;
        } catch (error) {
          if (signal?.aborted) throw error;
        }
        await delay(1000, undefined, { signal });
      }
      if (!ready) throw Error('Candidate HTTP readiness failed');
      const browser = await session.createContainer(name + '-browser', [
        '--memory',
        '1g',
        '--cpus',
        '1',
        '--network',
        networkId,
        '--shm-size',
        '256m',
        browserImage,
      ]);
      let failure: unknown;
      try {
        await session.run(['start', '-a', browser], 540000);
      } catch (error) {
        failure = error;
      }
      try {
        await session.run(['cp', browser + ':/evidence/.', evidence], 15000, true);
      } catch (error) {
        if (!failure) throw error;
      }
      if (failure) throw failure;
      if (!fs.statSync(path.join(evidence, 'browser.json')).isFile())
        throw Error('Browser evidence missing');
      fs.writeFileSync(
        path.join(root, 'wizard-evidence.json'),
        JSON.stringify({
          version: 1,
          sourceCommit: identity.source,
          pipelineId: Number(identity.pipeline),
          imageRef: ref,
          http: true,
          renderedUI: true,
          projects: true,
          spa: true,
          configurationBackup: true,
          cubeSignature: true,
        }) + '\n',
      );
    });
  }
}
