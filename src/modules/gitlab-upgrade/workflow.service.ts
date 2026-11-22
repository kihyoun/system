import { cliPath } from '../../common/runtime/installationPaths';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isDeepStrictEqual } from 'node:util';
import { Injectable } from '@nestjs/common';
import type { UpgradeSession } from './session';
import {
  root,
  gitlabConfigurationPath,
  release,
  parseEvidence,
  type EvidenceReceipt,
  type PlanReceipt,
  type UpgradePlan,
  type OperationReceipt,
  type OperationStatus,
  type Container,
} from './types';
import { atomic, jsonBytes, hash, runnerAssignment } from './policy';
import { upgradeStatus } from './status';

/** Docker may render equivalent --mount and Compose mounts with different Mode strings. */
function mountedState(value: Container['Mounts']) {
  return value
    ?.map((mount) => ({
      Destination: mount.Destination,
      Type: mount.Type,
      Source: mount.Source || '',
      Name: mount.Name || '',
      RW: mount.RW,
    }))
    .sort((left, right) => left.Destination.localeCompare(right.Destination));
}

@Injectable()
export class UpgradeWorkflowService {
  evidence(session: UpgradeSession): EvidenceReceipt {
    const bytes = jsonBytes(session.options.evidence),
      value = parseEvidence(bytes.toString('utf8')),
      p = value.evidence?.gitlabUpgrade;

    if (
      value.sourceRevision !== session.options.sourceRevision ||
      !Array.isArray(value.results) ||
      !value.results.length ||
      value.results.some((r) => r.status !== 'passed') ||
      value.fullAcceptance !== true ||
      p?.fromImage !== release.fromImage ||
      p?.toImage !== release.toImage ||
      p.migrationVerified !== true ||
      p.rollbackVerified !== true ||
      p.registryVerified !== true ||
      p.checkpointVerified !== true ||
      !/^sha256:[a-f0-9]{64}$/.test(value.images?.candidate || '') ||
      value.images.gitlab !== session.image(release.toImage) ||
      p.toImageId !== value.images.gitlab ||
      p.fromImageId !== session.image(release.fromImage)
    ) {
      throw Error('upgrade-passing-successor-evidence-required');
    }

    if (
      p.runnerImage !== release.runner.toImage ||
      p.runnerImageId !== value.images.runner ||
      p.runnerVersion !== release.runner.toVersion ||
      p.helperImage !== release.runner.helperImage ||
      p.jobCaBundleSha256 !== release.jobCaBundleSha256 ||
      p.securityTrustVerified !== true ||
      p.runnerUpgradeVerified !== true ||
      p.runnerManagerIdentityPreserved !== true ||
      p.fromRunnerImageId !== session.image(release.runner.fromImage) ||
      p.runnerImageId !== session.image(release.runner.toImage) ||
      p.helperImageId !== session.image(release.runner.helperImage) ||
      p.fromHelperImageId !== session.image(release.runner.fromHelperImage)
    ) {
      throw Error('upgrade-security-trust-evidence-required');
    }

    for (const stage of [
      'gitlab-upgrade-migrated-data',
      'gitlab-upgrade-registry-ci',
      'gitlab-upgrade-restored-checkpoint',
      'gitlab-upgrade-security-trust',
    ]) {
      if (!value.results.some((r) => r.name === stage && r.status === 'passed')) {
        throw Error('upgrade-passing-successor-evidence-required');
      }
    }
    const execution = session.publicExecution;

    if (execution) {
      const helper = session.inspect(execution.containerId),
        controller = session.inspect('system_bootstrapper_1');
      const recovery = execution.recoveryCheckpoint,
        recoveryMount = recovery
          ? helper.Mounts?.find((mount) => mount.Destination === recovery)
          : undefined,
        mounts = recovery
          ? helper.Mounts?.filter((mount) => mount.Destination !== recovery)
          : helper.Mounts;

      if (
        !/^[a-f0-9]{64}$/.test(execution.containerId) ||
        !/^[a-f0-9]{64}$/.test(execution.preparationSha256) ||
        helper.Id !== execution.containerId ||
        helper.Image !== value.images.candidate ||
        helper.State.Running !== true ||
        helper.Config?.Hostname !== os.hostname() ||
        helper.Config.Labels?.['system.gitlab.prerequisite'] !== execution.preparationSha256 ||
        helper.HostConfig?.PidMode !== 'host' ||
        helper.HostConfig.NetworkMode !== 'container:' + execution.controller.Id ||
        (recovery &&
          (!recoveryMount ||
            recoveryMount.Type !== 'bind' ||
            recoveryMount.RW !== false ||
            recoveryMount.Source !== recovery)) ||
        !isDeepStrictEqual(
          mountedState(mounts),
          mountedState(execution.controller.Mounts as Container['Mounts']),
        ) ||
        controller.State.Running !== true ||
        !isDeepStrictEqual(
          {
            Id: controller.Id,
            Image: controller.Image,
            Mounts: controller.Mounts,
            restartPolicy: controller.HostConfig?.RestartPolicy,
            labels: controller.Config?.Labels,
          },
          execution.controller,
        )
      ) {
        throw Error('upgrade-public-helper-identity-mismatch');
      }
    } else if (session.inspect('system_bootstrapper_1').Image !== value.images.candidate) {
      throw Error('upgrade-tested-controller-required');
    }

    return { sha256: hash(bytes), candidateImage: value.images.candidate };
  }

  async plan(session: UpgradeSession): Promise<PlanReceipt> {
    const evidence = session.evidence(),
      old = session.image(release.fromImage),
      target = session.image(release.toImage),
      current = await session.preflight(release.fromVersion);

    if (current.Image !== old) {
      throw Error('upgrade-current-image-mismatch');
    }

    const value = {
      format: 'system-gitlab-upgrade-plan-v1',
      sourceRevision: session.options.sourceRevision,
      releaseSha256: hash(
        fs.readFileSync(path.join(gitlabConfigurationPath, 'security-release.json')),
      ),
      evidence,
      containerId: current.Id,
      fromImageId: old,
      toImageId: target,
      configurationSha256: hash(session.configuration()),
      runner: session.runnerPlan(),
      checkpointDir: session.checkpoints,
    };
    return { plan: value, planSha256: hash(JSON.stringify(value)) };
  }

  async migrate(session: UpgradeSession, plan: UpgradePlan): Promise<OperationReceipt> {
    await session.quiesceScheduling();

    if (plan.runner) {
      session.owner.runnersStopped = true;
      session.updateOwner(session.owner.checkpointSha256);
      session.runnerPool('stop');
      session.runnersStopped(plan.runner);
    }

    await session.stop();
    const receipt = session.snapshot(plan);
    session.checkpoint(receipt.checkpointSha256);
    session.updateOwner(receipt.checkpointSha256);
    atomic(
      path.join(session.checkpoints, 'operation.json'),
      JSON.stringify({
        format: 'system-gitlab-upgrade-operation-v1',
        phase: 'checkpoint-complete',
        checkpointSha256: receipt.checkpointSha256,
      }),
    );

    if (plan.runner) {
      atomic(
        session.config,
        runnerAssignment(
          session.configuration(),
          session.runnerAliases[release.runner.toImage] || release.runner.toImage,
          session.runnerAliases,
        ),
      );
    }

    session.start(release.toImage);
    await session.ready(release.toVersion, plan.toImageId);

    if (plan.runner) {
      session.runnersReady(plan.runner);
    }

    session.run(
      process.execPath,
      [cliPath(root), 'projects-routing', 'routing', 'start', root, '/templates'],
      { cwd: root },
    );
    atomic(
      path.join(session.checkpoints, 'operation.json'),
      JSON.stringify({
        format: 'system-gitlab-upgrade-operation-v1',
        phase: 'promoted',
        checkpointSha256: receipt.checkpointSha256,
        toImage: release.toImage,
        sourceRevision: session.options.sourceRevision,
      }),
    );
    session.unlock();
    return {
      status: 'promoted',
      checkpointSha256: receipt.checkpointSha256,
      toImage: release.toImage,
    };
  }

  async promote(session: UpgradeSession, expected: string): Promise<OperationReceipt> {
    session.lock(expected);
    let entered = false;
    try {
      session.syncIdle();
      const value = await session.plan();

      if (value.planSha256 !== expected) {
        throw Error('upgrade-reviewed-plan-mismatch');
      }

      entered = true;
      return await session.migrate(value.plan);
    } catch (error) {
      if (!entered) {
        session.unlock();
      }

      throw error;
    }
  }

  async abort(session: UpgradeSession, expected: string): Promise<OperationReceipt> {
    if (!fs.existsSync(path.join(session.state, '.gitlab-upgrade-lock'))) {
      throw Error('upgrade-interrupted-operation-required');
    }

    session.adopt(expected, 'planSha256');
    await session.quiesceFinished();

    if (session.owner.checkpointSha256) {
      throw Error('upgrade-completed-checkpoint-requires-rollback');
    }

    const current = session.inspect('system_gitlab_1');
    session.verifyMounts(current);

    if (current.Image !== session.image(release.fromImage)) {
      throw Error('upgrade-current-image-mismatch');
    }

    if (!current.State.Running) {
      session.docker(['start', 'system_gitlab_1']);
    } else {
      session.docker(['exec', 'system_gitlab_1', 'gitlab-ctl', 'start']);
    }

    await session.ready(release.fromVersion, current.Image);

    if (session.owner.runnersStopped) {
      session.runnersReady(session.runnerPlan(false), true);
    }

    session.run(
      process.execPath,
      [cliPath(root), 'projects-routing', 'routing', 'start', root, '/templates'],
      { cwd: root },
    );
    session.unlock();
    return { status: 'previous-generation-resumed' };
  }

  status(session: UpgradeSession): OperationStatus {
    return upgradeStatus(session.checkpoints, session.state);
  }

  async rollback(session: UpgradeSession, expected: string): Promise<OperationReceipt> {
    const checkpoint = session.checkpoint(expected);
    session.adopt(expected, 'checkpointSha256');
    await session.quiesceFinished();
    const current = session.inspect('system_gitlab_1');
    session.verifyMounts(current);

    if (![checkpoint.plan.fromImageId, checkpoint.plan.toImageId].includes(current.Image)) {
      throw Error('upgrade-current-image-mismatch');
    }

    // The replacement data is discarded, so an exit1/OOM from a failed B is
    // not a reason to reject a verified cold A checkpoint. No writer may run.
    if (checkpoint.plan.runner) {
      session.runnerPool('stop');
      session.runnersStopped(checkpoint.plan.runner);
    }

    if (current.State.Running) {
      session.docker(['stop', '--time', '60', 'system_gitlab_1'], { timeout: 70000 });
    }

    if (session.inspect('system_gitlab_1').State.Running) {
      throw Error('upgrade-restore-writer-still-running');
    }

    session.restoreCheckpoint(checkpoint);
    session.start(release.fromImage, true);
    await session.ready(release.fromVersion, checkpoint.plan.fromImageId);

    if (checkpoint.plan.runner) {
      session.runnersReady(checkpoint.plan.runner, true);
    }

    session.run(
      process.execPath,
      [cliPath(root), 'projects-routing', 'routing', 'start', root, '/templates'],
      { cwd: root },
    );
    atomic(
      path.join(session.checkpoints, 'operation.json'),
      JSON.stringify({
        format: 'system-gitlab-upgrade-operation-v1',
        phase: 'restored-checkpoint',
        checkpointSha256: expected,
      }),
    );
    session.unlock();
    return { status: 'restored-checkpoint', checkpointSha256: expected };
  }
}
