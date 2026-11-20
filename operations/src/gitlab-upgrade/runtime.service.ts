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
import {
  atomic,
  imageAssignment,
  terminalContainerState,
  QUIESCE_SCRIPT,
  SCHEDULING_QUIESCE_SCRIPT,
  READINESS_SCRIPT,
} from './policy';

@Injectable()
export class UpgradeRuntimeService {
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
    const raw = session.docker(['exec', '-i', 'system_gitlab_1', 'gitlab-rails', 'runner', '-'], {
      input: fs.readFileSync(path.join(GITLAB, 'upgrade-preflight.rb'), 'utf8'),
    });
    const proof = parseRecord(raw.split('\n').at(-1) || '');
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
  stop(session: UpgradeSession): void {
    const deadline = Math.floor(childJournal.uptime()) + 200;
    if (session.owner) {
      session.owner.quiesceDeadline = deadline;
      session.updateOwner(session.owner.checkpointSha256);
    }
    const quiesce = QUIESCE_SCRIPT;
    session.docker(
      [
        'exec',
        '--env',
        'SVWAIT=90',
        'system_gitlab_1',
        '/bin/sh',
        '-ec',
        quiesce,
        'sh',
        String(deadline - 90),
      ],
      { timeout: 120000 },
    );
    session.docker(
      [
        'exec',
        'system_gitlab_1',
        '/bin/sh',
        '-ec',
        'found=false; for service in /opt/gitlab/service/*; do [ -L "$service" ] || continue; found=true; state=$(/opt/gitlab/embedded/bin/sv status "$service"); case "$state" in down:*) ;; *) exit 1 ;; esac; done; [ "$found" = true ]',
      ],
      { timeout: 10000 },
    );
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
      const readiness = session.docker([
        'exec',
        'system_gitlab_1',
        '/bin/sh',
        '-ec',
        READINESS_SCRIPT,
      ]);
      if (readiness === 'pending') {
        await session.sleep(3000);
        continue;
      }
      if (readiness !== 'ready') throw Error('upgrade-readiness-response-invalid');
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
    session.run('bash', ['start.sh'], {
      cwd: path.join(ROOT, 'gitlab'),
      env: {
        ...process.env,
        SYSTEM_CONFIG_DIR: session.state,
        SYSTEM_GITLAB_UPGRADE_OPERATION: session.operation,
      },
    });
  }
  syncIdle(session: UpgradeSession): void {
    const value = parseRecord(
      session.run(
        'bash',
        [
          '-ec',
          'set -a; source "$1"; source "$2"; node "$3" sync-status',
          'bash',
          path.join(session.state, 'sync-auth.env'),
          session.config,
          path.join(GITLAB, 'upgrade.js'),
        ],
        { timeout: 15000 },
      ),
    );
    if (value.idle !== true) throw Error('upgrade-sync-operation-running');
  }
  async resumeScheduling(session: UpgradeSession): Promise<void> {
    session.docker(
      [
        'exec',
        '--env',
        'SVWAIT=30',
        'system_gitlab_1',
        '/bin/sh',
        '-ec',
        'for service in nginx gitlab-workhorse puma; do timeout -k 2 45 gitlab-ctl start "$service"; done',
      ],
      { timeout: 150000 },
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
    session.docker(
      [
        'exec',
        '--env',
        'SVWAIT=90',
        'system_gitlab_1',
        '/bin/sh',
        '-ec',
        SCHEDULING_QUIESCE_SCRIPT,
        'sh',
        String(session.owner.quiesceDeadline),
      ],
      { timeout: 120000 },
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
