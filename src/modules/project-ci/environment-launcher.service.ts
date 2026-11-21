import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LifecycleProcess } from '../../common/runtime/managed-child';
import { validRequest } from '../project-lifecycle/state';
export const PROJECT_CI_PROCESS = Symbol('PROJECT_CI_PROCESS');
@Injectable()
export class EnvironmentLauncherService {
  constructor(@Inject(PROJECT_CI_PROCESS) private readonly process: LifecycleProcess) {}

  async run(
    action: string,
    kind: string,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<void> {
    const image = env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE || '';
    if (!/^sha256:[a-f0-9]{64}$/.test(image))
      throw Error('Immutable environment helper image required');
    const request = validRequest({
      action,
      kind,
      operation: env.SYSTEM_WIZARD_ENVIRONMENT_OPERATION,
      projectId: Number(env.CI_PROJECT_ID),
      pipelineId: Number(env.CI_PIPELINE_ID),
      jobId: Number(env.CI_JOB_ID),
      sourceCommit: env.CI_COMMIT_SHA,
      mrIid: Number(env.CI_MERGE_REQUEST_IID || 0),
    });
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, 360000);
    let helperId = '';
    let auth = '';
    const run = (args: string[], input = '', cleanup = false, timeout = 180000) =>
      this.process.run('docker', args, {
        cwd: process.cwd(),
        env,
        input,
        timeout,
        signal: cleanup ? undefined : controller.signal,
      });
    try {
      await run(['image', 'inspect', image]);
      auth = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-environment-registry-'));
      fs.chmodSync(auth, 0o700);
      if (action === 'deploy') {
        const ref = env.WIZARD_IMAGE_REF || '',
          registryImage = env.CI_REGISTRY_IMAGE || '';
        if (
          !registryImage ||
          !ref.startsWith(registryImage + '@sha256:') ||
          !/^[a-f0-9]{64}$/.test(ref.slice((registryImage + '@sha256:').length))
        )
          throw Error('Immutable candidate from the job registry required');
        if (!env.CI_REGISTRY || !env.CI_REGISTRY_USER || !env.CI_REGISTRY_PASSWORD)
          throw Error('Job-scoped registry credentials required');
        await run(
          [
            '--config',
            auth,
            'login',
            '--username',
            env.CI_REGISTRY_USER,
            '--password-stdin',
            env.CI_REGISTRY,
          ],
          env.CI_REGISTRY_PASSWORD + '\n',
        );
        await run(['--config', auth, 'pull', ref]);
      }
      const created = (
        await run([
          'create',
          '--name',
          `wizard-environment-${request.projectId}-${request.jobId}`,
          '--network',
          'none',
          '--read-only',
          '--memory',
          '256m',
          '--cpus',
          '1',
          '--pids-limit',
          '128',
          '--tmpfs',
          '/tmp:rw,nosuid,noexec,size=16m',
          '--label',
          `system.wizard.environments.helper=${request.operation}`,
          '--mount',
          'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
          '--mount',
          'type=volume,source=system_templates,target=/templates',
          '--mount',
          'type=volume,source=system_ssl,target=/ssl,readonly',
          '--entrypoint',
          'node',
          image,
          '/system/project-bootstrap/wizard-environments/helper.js',
          '--action',
          action,
          '--kind',
          kind,
          '--project',
          String(request.projectId),
          '--pipeline',
          String(request.pipelineId),
          '--job',
          String(request.jobId),
          '--sha',
          request.sourceCommit,
          '--mr',
          String(request.mrIid),
          '--operation',
          request.operation,
          '--controller',
          'system_bootstrapper_1',
        ])
      ).trim();
      if (!/^[a-f0-9]{64}$/.test(created)) throw Error('Invalid helper creation identity');
      helperId = created;
      await run(['start', '--attach', helperId]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (auth) fs.rmSync(auth, { recursive: true, force: true });
      if (helperId) {
        const identity = (
          await run(
            [
              'container',
              'inspect',
              '--format',
              '{{.Id}} {{.Image}} {{index .Config.Labels "system.wizard.environments.helper"}}',
              helperId,
            ],
            '',
            true,
            15000,
          )
        ).trim();
        if (identity !== `${helperId} ${image} ${request.operation}`)
          throw Error('Helper ownership changed; cleanup refused');
        await run(['stop', '--time', '120', helperId], '', true, 130000);
        await run(['rm', '-f', helperId], '', true, 15000);
      }
    }
  }
}
