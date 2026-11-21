import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { HostModule } from './host.module';
import { lifecyclePolicy } from '../release/lifecycle-policy';
import { HostReleaseAuthorityService } from './release-authority.service';
import { PublicUpgradePreparationService } from './public-upgrade-preparation.service';
import {
  PublicGitlabPrerequisiteService,
  prerequisiteController,
  pairedPrerequisiteRecovery,
} from './public-gitlab-prerequisite.service';
import { GitLabUpgradeService } from '../gitlab-upgrade/gitlab-upgrade.service';
import { GitLabUpgradeModule } from '../gitlab-upgrade/gitlab-upgrade.module';
import { ROOT, type PublicPrerequisiteExecution } from '../gitlab-upgrade/types';
import { record } from '../release/source-identity';
import { readPrivateInput } from './private-input';
import { writePrivate, requireValue as ensure } from './install';
import { bytesSha } from './release-selection.service';

@Module({
  imports: [HostModule.register({ lifecycleEvidence: lifecyclePolicy() }), GitLabUpgradeModule],
})
class PublicGitlabPrerequisiteHelperModule {}

export async function publicGitlabHelperMain(args = process.argv.slice(2)): Promise<void> {
  const [filename, launchFile, operation, confirmation] = args;
  ensure(
    args.length === 4 &&
      /^\/state\/gitlab-prerequisites\/[a-z0-9][a-z0-9-]{0,79}\/preparation\.json$/.test(
        filename,
      ) &&
      path.dirname(launchFile) === path.dirname(filename) &&
      /^launch-[a-f0-9]{32}\.json$/.test(path.basename(launchFile)) &&
      ['plan', 'promote', 'status', 'abort', 'rollback'].includes(operation) &&
      (['plan', 'status'].includes(operation)
        ? confirmation === ''
        : /^[a-f0-9]{64}$/.test(confirmation)),
    'public-gitlab-helper-usage-invalid',
  );
  const app = await NestFactory.createApplicationContext(PublicGitlabPrerequisiteHelperModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const bytes = readPrivateInput(filename),
      retained = record(JSON.parse(bytes.toString())),
      launch = record(JSON.parse(readPrivateInput(launchFile).toString())),
      metadata = record(retained.metadata),
      previous = record(retained.previous),
      security = JSON.parse(
        fs.readFileSync(path.join(ROOT, 'gitlab/security-release.json'), 'utf8'),
      ),
      accepted = app
        .get(HostReleaseAuthorityService)
        .publicInputs(metadata, Buffer.from(String(retained.proof), 'base64'), security),
      native = app.get(PublicGitlabPrerequisiteService),
      controller = native.inspect('system_bootstrapper_1');
    ensure(
      retained.format === 'system-public-gitlab-prerequisite-v1' &&
        typeof retained.root === 'string' &&
        path.isAbsolute(retained.root) &&
        retained.root !== '/' &&
        !retained.root.startsWith(ROOT + '/') &&
        retained.root !== ROOT &&
        retained.directory ===
          path.join(
            retained.root,
            'configuration/gitlab-prerequisites',
            path.basename(path.dirname(filename)),
          ) &&
        retained.checkpointDir ===
          path.join(
            retained.root,
            'configuration/gitlab-upgrades/public-' + path.basename(path.dirname(filename)),
          ) &&
        isDeepStrictEqual(accepted.graph, app.get(PublicUpgradePreparationService).graph(ROOT)) &&
        launch.preparationSha256 === bytesSha(bytes) &&
        typeof launch.containerId === 'string' &&
        isDeepStrictEqual(prerequisiteController(controller), launch.controller) &&
        controller.Image === record(record(previous.images).controller).imageId,
      'public-gitlab-helper-authority-mismatch',
    );
    if (!isDeepStrictEqual(prerequisiteController(controller), retained.controller)) {
      ensure(
        operation === 'rollback' && typeof launch.pairedCheckpoint === 'string',
        'public-gitlab-original-controller-changed',
      );
      pairedPrerequisiteRecovery(
        retained,
        controller,
        launch.pairedCheckpoint,
        '/state/.docker.env',
      );
    } else ensure(!launch.pairedCheckpoint, 'public-gitlab-paired-checkpoint-not-required');
    const execution: PublicPrerequisiteExecution = {
      containerId: launch.containerId,
      preparationSha256: bytesSha(bytes),
      controller: prerequisiteController(controller),
      ...(typeof launch.pairedCheckpoint === 'string'
        ? { recoveryCheckpoint: launch.pairedCheckpoint }
        : {}),
    };
    const evidence = path.join(path.dirname(filename), 'accepted-evidence.json');
    writePrivate(evidence, Buffer.from(JSON.stringify(accepted.evidence)));
    const session = app.get(GitLabUpgradeService).create(
      {
        sourceRevision: accepted.release.sourceRevision,
        evidence,
        stateDir: '/state',
        persistentDir: retained.root,
        checkpointDir: '/state/gitlab-upgrades/public-' + path.basename(path.dirname(filename)),
        readyTimeoutSeconds: retained.timeout,
      },
      { publicExecution: execution },
    );
    // This validates the actual helper image, original controller, complete public
    // acceptance evidence and all six local image pins even for offline recovery.
    session.evidence();
    for (const [name, directory] of [
      ['.docker.env', false],
      ['.projects.env', true],
    ] as const) {
      const source = path.join('/state', name),
        destination = path.join(ROOT, 'system', name);
      const stat = fs.lstatSync(source);
      ensure(
        !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()),
        'public-gitlab-saved-configuration-required',
      );
      const existing = fs.lstatSync(destination, { throwIfNoEntry: false });
      if (existing) {
        ensure(
          directory && existing.isDirectory() && !existing.isSymbolicLink(),
          'public-gitlab-clean-helper-runtime-required',
        );
        fs.rmSync(destination, { recursive: true });
      }
      fs.symlinkSync(source, destination, directory ? 'dir' : 'file');
    }
    // Runtime addresses are ephemeral. Reconstruct them from owned containers;
    // never run controller startup or replace its network while preparing GitLab.
    for (const [name, relative, key] of [
      ['system_bootstrapper_1', '.docker.env', 'BOOTSTRAPPER_IP'],
      ['system_gitlab_1', 'gitlab/.docker.env', 'GITLAB_IP'],
      ['system_wizard_1', 'wizard/.docker.env', 'WIZARD_IP'],
    ]) {
      const address = native
        .docker([
          'inspect',
          '--format',
          '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
          name,
        ])
        .trim();
      ensure(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address), 'public-gitlab-service-address-required');
      fs.writeFileSync(path.join(ROOT, relative), 'export ' + key + '=' + address + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
    }
    // Check native recovery dependencies before the first writer is stopped.
    session.run('rsync', ['--version']);
    session.run('docker', ['compose', 'version']);
    const result =
      operation === 'plan'
        ? await session.plan()
        : operation === 'status'
          ? session.status()
          : operation === 'promote'
            ? await session.promote(confirmation)
            : operation === 'abort'
              ? await session.abort(confirmation)
              : await session.rollback(confirmation);
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await app.close();
  }
}
if (require.main === module)
  void publicGitlabHelperMain().catch(() => {
    process.stderr.write(
      'Public GitLab prerequisite stopped; inspect retained helper, leases and checkpoint.\n',
    );
    process.exitCode = 1;
  });
