import { environmentAssignments } from '../runtime/environment-assignments';
import { GitlabPreflightService } from '../gitlab-preflight/gitlab-preflight.service';
import {
  controlGitLabServices,
  requireGitLabServicesDown,
  gitLabReadiness,
} from './service-control';
import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import type { UpgradeSession } from './session';
import {
  ROOT,
  GITLAB,
  release,
  childJournal,
  readRecord,
  parseRecord,
  parseContainer,
  parseImage,
  type CommandOptions,
  type Container,
} from './types';
import { atomic, imageAssignment, terminalContainerState } from './policy';

@Injectable()
export class UpgradeRuntimeService {
  constructor(private readonly gitlabPreflight: GitlabPreflightService) {}
  private control(session: UpgradeSession) {
    return {
      command: (args: string[], timeout: number) =>
        session.docker(args, { timeout: timeout * 1000 }),
      uptime: () => childJournal.uptime(),
    };
  }
  docker(session: UpgradeSession, args: string[], opts?: CommandOptions): string {
    return session.run('docker', args, opts);
  }
  inspect(session: UpgradeSession, name: string): Container {
    return parseContainer(session.docker(['inspect', name]));
  }
  image(session: UpgradeSession, reference: string): string {
    const prepared = session.imageIds?.[reference];
    const image = parseImage(session.docker(['image', 'inspect', prepared || reference]));
    if (prepared) {
      if (image.Id !== prepared) throw Error('upgrade-image-pin-mismatch');
      return prepared;
    }
    if (
      !/^sha256:[a-f0-9]{64}$/.test(image.Id || '') ||
      !image.RepoDigests?.some((ref) => ref.split('@')[1] === reference.split('@')[1])
    )
      throw Error('upgrade-image-pin-mismatch');
    return image.Id;
  }
  verifyMounts(session: UpgradeSession, container: Container): void {
    for (const [target, suffix, volume] of [
      ['/etc/gitlab', 'gitlab/config', 'system_gitlabConfig'],
      ['/var/log/gitlab', 'gitlab/logs', 'system_gitlabLogs'],
      ['/var/opt/gitlab', 'gitlab/data', 'system_gitlabData'],
    ]) {
      const mount = container.Mounts?.find((m) => m.Destination === target),
        expected = path.posix.join(session.options.persistentDir, suffix);
      if (!mount || mount.RW !== true) throw Error('upgrade-persistent-mount-mismatch');
      if (mount.Type === 'volume') {
        const v = readRecord(JSON.parse(session.docker(['volume', 'inspect', mount.Name]))[0]);
        if (
          mount.Name !== volume ||
          readRecord(v.Options).device !== expected ||
          readRecord(v.Options).type !== 'none' ||
          readRecord(v.Options).o !== 'bind'
        )
          throw Error('upgrade-persistent-mount-mismatch');
      } else if (mount.Type !== 'bind' || mount.Source !== expected)
        throw Error('upgrade-persistent-mount-mismatch');
    }
    if (
      container.Config?.Labels?.['com.docker.compose.project'] !== 'system' ||
      container.Config.Labels['com.docker.compose.service'] !== 'gitlab'
    )
      throw Error('upgrade-owned-gitlab-required');
  }
  async preflight(session: UpgradeSession, version: string): Promise<Container> {
    const gitlab = session.inspect('system_gitlab_1');
    session.verifyMounts(gitlab);
    if (!gitlab.State?.Running || gitlab.State?.OOMKilled)
      throw Error('upgrade-running-gitlab-required');
    const proof = await this.gitlabPreflight.probe(gitlab.Id!, {
      command: (args, timeout, input) => session.docker(args, { timeout: timeout * 1000, input }),
    });
    if (proof.version !== version || proof.edition !== 'CE')
      throw Object.assign(Error('upgrade-preflight-identity-mismatch'), { noRetry: true });
    if (
      typeof proof.runningJobs !== 'number' ||
      !Number.isInteger(proof.runningJobs) ||
      proof.runningJobs < 0 ||
      typeof proof.unfinishedBackgroundMigrations !== 'number' ||
      !Number.isInteger(proof.unfinishedBackgroundMigrations) ||
      proof.unfinishedBackgroundMigrations < 0
    )
      throw Error('upgrade-preflight-refused');
    if (proof.unfinishedBackgroundMigrations !== 0) throw Error('upgrade-pending-migrations');
    if (proof.runningJobs !== 0) throw Error('upgrade-jobs-active');
    return gitlab;
  }
  async stop(session: UpgradeSession): Promise<void> {
    const deadline = Math.floor(childJournal.uptime()) + 200;
    if (session.owner) {
      session.owner.quiesceDeadline = deadline;
      session.updateOwner(session.owner.checkpointSha256);
    }
    const port = this.control(session);
    await controlGitLabServices(port, 'system_gitlab_1', 'stop', 110, [''], {
      deadline: deadline - 90,
      grace: 10,
    });
    await requireGitLabServicesDown(port, 'system_gitlab_1', 5);
    const remaining = Math.min(60, deadline - Math.floor(childJournal.uptime()));
    if (remaining < 1) throw Error('upgrade-quiesce-deadline-exceeded');
    session.docker(['stop', '--time', String(remaining), 'system_gitlab_1'], {
      timeout: remaining * 1000 + 10000,
    });
    const state = session.inspect('system_gitlab_1').State;
    if (state.Running || state.ExitCode !== 0 || state.OOMKilled)
      throw Error('upgrade-clean-stop-required');
  }
  async ready(session: UpgradeSession, version: string, image: string): Promise<void> {
    const until = session.now() + session.options.readyTimeoutSeconds * 1000;
    while (session.now() < until) {
      const container = session.inspect('system_gitlab_1');
      if (container.Image !== image)
        throw Object.assign(Error('upgrade-current-image-mismatch'), { noRetry: true });
      const terminal = terminalContainerState(container);
      if (terminal)
        throw Object.assign(Error('upgrade-service-' + terminal), {
          noRetry: true,
          ...(typeof container.State.ExitCode === 'number' &&
          Number.isInteger(container.State.ExitCode) &&
          container.State.ExitCode >= 0 &&
          container.State.ExitCode <= 255
            ? { exitCode: container.State.ExitCode }
            : {}),
        });
      const state = container.State || {},
        policy = container.HostConfig?.RestartPolicy;
      const restarting =
        state.Status === 'exited' &&
        (['always', 'unless-stopped'].includes(policy?.Name || '') ||
          (policy?.Name === 'on-failure' &&
            typeof state.ExitCode === 'number' &&
            Number.isInteger(state.ExitCode) &&
            state.ExitCode > 0 &&
            (policy.MaximumRetryCount === 0 ||
              (typeof policy.MaximumRetryCount === 'number' &&
                Number.isInteger(policy.MaximumRetryCount) &&
                policy.MaximumRetryCount > 0 &&
                typeof container.RestartCount === 'number' &&
                Number.isInteger(container.RestartCount) &&
                container.RestartCount < policy.MaximumRetryCount))));
      if (
        state.Status === 'created' ||
        state.Restarting === true ||
        state.Status === 'restarting' ||
        restarting
      ) {
        await session.sleep(3000);
        continue;
      }
      if (state.Running !== true || state.Paused === true)
        throw Object.assign(Error('upgrade-service-state-invalid'), { noRetry: true });
      // Only curl's explicit HTTP/connection startup states are retryable. A
      // failed Docker exec, missing executable or malformed response is fatal.
      if (!(await gitLabReadiness(this.control(session), 'system_gitlab_1'))) {
        await session.sleep(3000);
        continue;
      }
      try {
        await session.preflight(version);
      } catch (error) {
        if (
          (error instanceof Error && 'noRetry' in error && error.noRetry === true) ||
          !['upgrade-jobs-active', 'upgrade-pending-migrations'].includes(
            error instanceof Error ? error.message : '',
          )
        )
          throw error;
        await session.sleep(3000);
        continue;
      }
      const status = session.docker(
        ['exec', 'system_gitlab_1', 'gitlab-rake', 'db:migrate:status'],
        { timeout: 180000 },
      );
      const migrations = [...status.matchAll(/^\s*(up|down)\s+\d+/gm)];
      if (!migrations.length) throw Error('upgrade-migration-status-invalid');
      if (migrations.some((row) => row[1] === 'down')) {
        await session.sleep(3000);
        continue;
      }
      return;
    }
    throw Error('upgrade-readiness-timeout');
  }
  start(session: UpgradeSession, reference: string, restore = false): void {
    if (!restore)
      atomic(
        session.config,
        imageAssignment(
          session.configuration(),
          session.aliases[reference] || reference,
          session.aliases,
        ),
      );
    session.run(
      process.execPath,
      [path.join(ROOT, 'operations/dist/lifecycle/entry.js'), 'gitlab-start', ROOT],
      {
        cwd: path.join(ROOT, 'gitlab'),
        env: {
          ...process.env,
          SYSTEM_CONFIG_DIR: session.state,
          SYSTEM_GITLAB_UPGRADE_OPERATION: session.operation,
        },
      },
    );
  }
  syncIdle(session: UpgradeSession): void {
    const value = parseRecord(
      session.run(process.execPath, [path.join(GITLAB, 'upgrade.js'), 'sync-status'], {
        timeout: 15000,
        env: {
          ...process.env,
          ...environmentAssignments(
            fs.readFileSync(path.join(session.state, 'sync-auth.env'), 'utf8'),
          ),
          ...environmentAssignments(fs.readFileSync(session.config, 'utf8')),
        },
      }),
    );
    if (value.idle !== true) throw Error('upgrade-sync-operation-running');
  }
  async resumeScheduling(session: UpgradeSession): Promise<void> {
    await controlGitLabServices(
      this.control(session),
      'system_gitlab_1',
      'start',
      150,
      ['nginx', 'gitlab-workhorse', 'puma'],
      { svWait: 30, perService: 45, grace: 5 },
    );
    const until = session.now() + Math.min(session.options.readyTimeoutSeconds, 300) * 1000;
    while (session.now() < until) {
      try {
        session.docker(
          [
            'exec',
            'system_gitlab_1',
            'curl',
            '-fsS',
            '--max-time',
            '5',
            'http://127.0.0.1/-/readiness',
          ],
          { timeout: 10000 },
        );
        return;
      } catch {
        await session.sleep(1000);
      }
    }
    throw Error('upgrade-previous-ingress-not-ready');
  }
  async quiesceScheduling(session: UpgradeSession): Promise<void> {
    session.owner.phase = 'quiescing-scheduling';
    session.owner.quiesceDeadline = Math.floor(childJournal.uptime()) + 110;
    session.updateOwner(session.owner.checkpointSha256);
    // Once all three HTTP entry/handler services are down, native and external
    // managers cannot claim a new job or register a new runner. Existing runner
    // paused flags and manager containers are untouched.
    await controlGitLabServices(
      this.control(session),
      'system_gitlab_1',
      'stop',
      110,
      ['nginx', 'gitlab-workhorse', 'puma'],
      { deadline: session.owner.quiesceDeadline, grace: 10 },
    );
    session.owner.phase = 'scheduling-quiesced';
    session.updateOwner(session.owner.checkpointSha256);
    try {
      await session.preflight(release.fromVersion);
    } catch (error) {
      // An assignment already in flight may have committed before Puma drained.
      // Restore the old HTTP service without stopping DB/runners or taking a
      // checkpoint; do not cancel or kill that active job.
      await session.resumeScheduling();
      session.owner.phase = 'scheduling-aborted';
      session.updateOwner(session.owner.checkpointSha256);
      session.unlock();
      throw error;
    }
  }
}
