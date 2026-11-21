import { cliArguments } from '../../common/runtime/installation-paths';
import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import type { UpgradeSession } from './session';
import { ROOT, release, parseImage, type RunnerPlan } from './types';
import { atomic, regular, jsonBytes, hash, runnerSelection, runnerHelper } from './policy';

@Injectable()
export class UpgradeRunnerService {
  runnerReference(session: UpgradeSession, text = session.configuration()): string {
    // Earlier installers saved this exact version tag. Its content must still
    // match the reviewed public pin; checkpoints keep the original assignment.
    return runnerSelection(text, session.runnerAliases, (selected, pinned) => {
      const image = parseImage(session.docker(['image', 'inspect', selected]));
      const digest = pinned.replace(/:[^/:@]+(?=@sha256:)/, '');
      if (image.Id !== session.image(pinned) || !image.RepoDigests?.includes(digest))
        throw Error('upgrade-retained-runner-image-pin-mismatch');
    });
  }

  runnerPlan(session: UpgradeSession, verifyRunning = true): RunnerPlan {
    const text = session.configuration(),
      reference = session.runnerReference(text),
      fromImageId = session.image(reference),
      toImageId = session.image(release.runner.toImage),
      helperImageId = session.image(release.runner.helperImage),
      fromHelperImageId = session.image(release.runner.fromHelperImage);
    if (reference !== release.runner.fromImage)
      throw Error('upgrade-current-runner-image-mismatch');
    const matches = [...text.matchAll(/^(?:export )?GITLAB_RUNNER_SCALE=['"]?([0-9]+)['"]?$/gm)];
    if (matches.length !== 1 || Number(matches[0][1]) > 50)
      throw Error('upgrade-runner-scale-invalid');
    const scale = Number(matches[0][1]);
    for (let index = 1; verifyRunning && index <= scale; index++) {
      const container = session.inspect('runner_docker_' + index),
        labels = container.Config?.Labels;
      if (
        !container.State?.Running ||
        container.Image !== fromImageId ||
        labels?.['com.docker.compose.project'] !== 'runner' ||
        labels?.['com.docker.compose.service'] !== 'docker_' + index
      )
        throw Error('upgrade-owned-runner-image-mismatch');
    }
    const configurations = [];
    for (const pool of fs.readdirSync(session.runnerData).sort()) {
      if (!/^(?:runner|[a-z0-9][a-z0-9_-]*_runner)$/.test(pool)) continue;
      const directory = path.join(session.runnerData, pool);
      if (fs.lstatSync(directory).isSymbolicLink()) throw Error('upgrade-runner-config-symlink');
      for (const index of fs.readdirSync(directory).sort()) {
        if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(index)) continue;
        const relative = path.posix.join(pool, index, 'config'),
          config = path.join(session.runnerData, relative),
          toml = path.join(config, 'config.toml');
        if (fs.realpathSync(config) !== config) throw Error('upgrade-runner-config-symlink');
        regular(toml);
        runnerHelper(jsonBytes(toml).toString('utf8'), undefined, session.helperAliases);
        const identity = path.join(config, '.runner_system_id');
        regular(identity);
        configurations.push({
          path: relative,
          sha256: hash(jsonBytes(toml)),
          managerIdentitySha256: hash(
            jsonBytes(identity, 1024, 'upgrade-runner-identity-too-large'),
          ),
        });
      }
    }
    for (let index = 1; index <= scale; index++)
      if (!configurations.some((row) => row.path === 'runner/' + index + '/config'))
        throw Error('upgrade-retained-runner-config-required');
    return {
      fromImage: reference,
      fromImageId,
      toImageId,
      helperImageId,
      fromHelperImageId,
      scale,
      configurations,
    };
  }

  runnerPool(session: UpgradeSession, script: 'start' | 'stop'): void {
    session.run(
      process.execPath,
      cliArguments('lifecycle', [script === 'start' ? 'runner-start' : 'runner-stop', ROOT], ROOT),
      {
        cwd: path.join(ROOT, 'config/gitlab-runner'),
        timeout: 600000,
        env: {
          ...process.env,
          SYSTEM_CONFIG_DIR: session.state,
          SYSTEM_GITLAB_UPGRADE_OPERATION: session.operation,
        },
      },
    );
  }

  runnersStopped(session: UpgradeSession, plan: RunnerPlan): void {
    const names = new Set(session.docker(['ps', '--all', '--format', '{{.Names}}']).split('\n'));
    for (const row of plan.configurations) {
      const [pool, index] = row.path.split('/'),
        name = pool + '_docker_' + index;
      if (names.has(name) && session.inspect(name).State?.Running)
        throw Error('upgrade-runner-writer-still-running');
    }
  }

  runnersReady(session: UpgradeSession, plan: RunnerPlan, restore = false): void {
    const reference = session.runnerReference(),
      expected = restore ? plan.fromImageId : plan.toImageId;
    if (session.image(reference) !== expected || (!restore && reference !== release.runner.toImage))
      throw Error('upgrade-runner-image-mismatch');
    if (!restore)
      for (const row of plan.configurations) {
        const file = path.join(session.runnerData, row.path, 'config.toml');
        atomic(
          file,
          runnerHelper(
            jsonBytes(file).toString('utf8'),
            session.helperAliases[release.runner.helperImage] || release.runner.helperImage,
            session.helperAliases,
          ),
        );
      }
    session.runnerPool('start');
    for (const row of plan.configurations)
      if (
        hash(
          jsonBytes(
            path.join(session.runnerData, row.path, '.runner_system_id'),
            1024,
            'upgrade-runner-identity-too-large',
          ),
        ) !== row.managerIdentitySha256
      )
        throw Error('upgrade-runner-manager-identity-changed');
    for (let index = 1; index <= plan.scale; index++) {
      const name = 'runner_docker_' + index,
        container = session.inspect(name);
      if (!container.State?.Running || container.Image !== expected)
        throw Error('upgrade-runner-image-mismatch');
      const version =
        reference === release.runner.toImage
          ? release.runner.toVersion
          : release.runner.fromVersion;
      if (
        !session
          .docker(['exec', name, 'gitlab-runner', '--version'])
          .split('\n')
          .some((line) => line.trim() === 'Version:      ' + version)
      )
        throw Error('upgrade-runner-version-mismatch');
      session.docker(['exec', name, 'gitlab-runner', 'verify']);
    }
    const running = new Set(session.docker(['ps', '--format', '{{.Names}}']).split('\n'));
    for (const row of plan.configurations) {
      const [pool, index] = row.path.split('/'),
        name = pool + '_docker_' + index;
      if (running.has(name) && session.inspect(name).Image !== expected)
        throw Error('upgrade-project-runner-image-mismatch');
    }
  }
}
