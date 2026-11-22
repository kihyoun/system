import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import type { UpgradeSession } from './session';
import {
  release,
  parseCheckpoint,
  type UpgradePlan,
  type CheckpointReceipt,
  type Checkpoint,
} from './types';
import {
  atomic,
  regular,
  jsonBytes,
  json,
  hash,
  cube,
  runnerCheckpoint,
  inventory,
  inventoryAt,
  durableDirectory,
  durableAncestors,
  CHECKPOINT_JSON_MAX_BYTES,
} from './policy';

@Injectable()
export class UpgradeCheckpointService {
  configuration(session: UpgradeSession): string {
    regular(session.config);
    const text = fs.readFileSync(session.config, 'utf8');
    cube(text);
    return text;
  }

  snapshot(session: UpgradeSession, plan: UpgradePlan): CheckpointReceipt {
    if (fs.existsSync(session.checkpoints)) {
      throw Error('upgrade-new-checkpoint-directory-required');
    }

    fs.mkdirSync(session.checkpoints, { recursive: true, mode: 0o700 });

    if (fs.realpathSync(session.checkpoints) !== session.checkpoints) {
      throw Error('upgrade-symlink-checkpoint-refused');
    }

    runnerCheckpoint(plan.runner);
    const size = [
        session.serviceData,
        ...(plan.runner?.configurations || []).map((row) =>
          path.join(session.runnerData, row.path),
        ),
      ].reduce(
        (sum, directory) => sum + Number(session.run('du', ['-sb', directory]).split(/\s/)[0]),
        0,
      ),
      space = fs.statfsSync(session.checkpoints);

    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      space.bavail * space.bsize < size * 1.25 + 104857600
    ) {
      throw Error('upgrade-checkpoint-space-insufficient');
    }

    fs.mkdirSync(path.join(session.checkpoints, 'gitlab'), { mode: 0o700 });
    fs.mkdirSync(path.join(session.checkpoints, 'configuration'), { mode: 0o700 });
    for (const name of ['config', 'data', 'log']) {
      session.run('rsync', [
        '-a',
        '--no-specials',
        '--no-devices',
        '--fsync',
        session.serviceData + '/' + name + '/',
        path.join(session.checkpoints, 'gitlab', name) + '/',
      ]);
    }
    for (const name of ['.docker.env', 'sync-auth.env']) {
      regular(path.join(session.state, name));
      atomic(
        path.join(session.checkpoints, 'configuration', name),
        fs.readFileSync(path.join(session.state, name)),
      );
    }

    if (plan.runner) {
      for (const row of plan.runner.configurations) {
        const source = path.join(session.runnerData, row.path),
          destination = path.join(session.checkpoints, 'configuration/runners', row.path);

        if (
          hash(jsonBytes(path.join(source, 'config.toml'))) !== row.sha256 ||
          hash(
            jsonBytes(
              path.join(source, '.runner_system_id'),
              1024,
              'upgrade-runner-identity-too-large',
            ),
          ) !== row.managerIdentitySha256
        ) {
          throw Error('upgrade-runner-config-changed-before-checkpoint');
        }

        fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
        session.run('rsync', [
          '-a',
          '--no-specials',
          '--no-devices',
          '--fsync',
          source + '/',
          destination + '/',
        ]);
      }
    }

    const value = {
        format: 'system-gitlab-cold-checkpoint-v1',
        sourceRevision: session.options.sourceRevision,
        createdAt: new Date().toISOString(),
        plan,
        entries: inventory(session.checkpoints),
      },
      bytes = JSON.stringify(value);

    if (Buffer.byteLength(bytes) > CHECKPOINT_JSON_MAX_BYTES) {
      throw Error('upgrade-checkpoint-too-large');
    }

    for (const entry of [...value.entries].reverse()) {
      if (entry.type === 'directory') {
        durableDirectory(path.join(session.checkpoints, entry.path));
      }
    }
    durableAncestors(session.checkpoints);
    atomic(path.join(session.checkpoints, 'checkpoint.json'), bytes);
    return { checkpoint: value, checkpointSha256: hash(bytes) };
  }

  checkpoint(session: UpgradeSession, expected: string): Checkpoint {
    const file = path.join(session.checkpoints, 'checkpoint.json'),
      bytes = jsonBytes(file, CHECKPOINT_JSON_MAX_BYTES, 'upgrade-checkpoint-too-large');

    if (!/^[a-f0-9]{64}$/.test(expected) || hash(bytes) !== expected) {
      throw Error('upgrade-checkpoint-verification-failed');
    }

    const value = parseCheckpoint(bytes.toString('utf8'));
    runnerCheckpoint(value.plan?.runner);

    if (
      value.plan?.runner &&
      (value.plan.runner.fromImageId !== session.image(value.plan.runner.fromImage) ||
        value.plan.runner.toImageId !== session.image(release.runner.toImage) ||
        value.plan.runner.helperImageId !== session.image(release.runner.helperImage) ||
        value.plan.runner.fromHelperImageId !== session.image(release.runner.fromHelperImage))
    ) {
      throw Error('upgrade-runner-checkpoint-invalid');
    }

    if (
      value.format !== 'system-gitlab-cold-checkpoint-v1' ||
      value.sourceRevision !== session.options.sourceRevision ||
      value.plan?.fromImageId !== session.image(release.fromImage) ||
      value.plan?.toImageId !== session.image(release.toImage) ||
      JSON.stringify(value.entries) !== JSON.stringify(inventory(session.checkpoints))
    ) {
      throw Error('upgrade-checkpoint-verification-failed');
    }

    if (
      value.plan.runner &&
      session.runnerReference(
        jsonBytes(path.join(session.checkpoints, 'configuration/.docker.env')).toString('utf8'),
      ) !== value.plan.runner.fromImage
    ) {
      throw Error('upgrade-runner-checkpoint-invalid');
    }

    return value;
  }

  restore(session: UpgradeSession, checkpoint: Checkpoint): void {
    const marker = path.join(session.serviceData, 'data/.system-bootstrapper-restore-incomplete');
    atomic(marker, 'gitlab-upgrade-checkpoint-restore\n');
    for (const name of ['config', 'data', 'log']) {
      session.run('rsync', [
        '-a',
        '--no-specials',
        '--no-devices',
        '--fsync',
        '--checksum',
        '--delete',
        '--exclude=.system-bootstrapper-restore-incomplete',
        path.join(session.checkpoints, 'gitlab', name) + '/',
        session.serviceData + '/' + name + '/',
      ]);
    }
    atomic(
      session.config,
      fs.readFileSync(path.join(session.checkpoints, 'configuration/.docker.env')),
    );
    atomic(
      path.join(session.state, 'sync-auth.env'),
      fs.readFileSync(path.join(session.checkpoints, 'configuration/sync-auth.env')),
    );
    const runnerRoots = (checkpoint.plan.runner?.configurations || []).map((row) => ({
      full: path.join(session.runnerData, row.path),
      path: 'configuration/runners/' + row.path,
    }));
    for (const root of runnerRoots) {
      session.run('rsync', [
        '-a',
        '--no-specials',
        '--no-devices',
        '--fsync',
        '--checksum',
        '--delete',
        path.join(session.checkpoints, root.path) + '/',
        root.full + '/',
      ]);
    }
    const expectedEntries = checkpoint.entries.filter(
      (entry) =>
        entry.path.startsWith('gitlab/') ||
        ['configuration/.docker.env', 'configuration/sync-auth.env'].includes(entry.path) ||
        runnerRoots.some(
          (root) => entry.path === root.path || entry.path.startsWith(root.path + '/'),
        ),
    );
    const actualEntries = inventoryAt(
      [
        ...['config', 'data', 'log'].map((name) => ({
          full: path.join(session.serviceData, name),
          path: 'gitlab/' + name,
        })),
        { full: session.config, path: 'configuration/.docker.env' },
        ...runnerRoots,
        { full: path.join(session.state, 'sync-auth.env'), path: 'configuration/sync-auth.env' },
      ],
      new Set(['gitlab/data/.system-bootstrapper-restore-incomplete']),
    );

    if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
      throw Error('upgrade-restored-payload-mismatch');
    }

    for (const entry of [...checkpoint.entries].reverse()) {
      if (entry.type === 'directory' && entry.path.startsWith('gitlab/')) {
        const name = entry.path.replace(/^gitlab\//, session.serviceData + '/');
        const fd = fs.openSync(name, 'r');
        try {
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
    }
    for (const root of runnerRoots) {
      for (const entry of [...checkpoint.entries].reverse()) {
        if (
          entry.type === 'directory' &&
          (entry.path === root.path || entry.path.startsWith(root.path + '/'))
        ) {
          durableDirectory(path.join(root.full, entry.path.slice(root.path.length)));
        }
      }
    }
    fs.unlinkSync(marker);
    const descriptor = fs.openSync(path.join(session.serviceData, 'data'), 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  }
}
