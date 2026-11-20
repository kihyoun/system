import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { HostInstallService, requireValue as ensure } from './install';
import { record, imageId, revision } from '../release/source-identity';
import { fileSha } from './recovery-manifest';
export interface GitLabPrerequisite {
  kind: 'native-gitlab-cold-checkpoint';
  fromVersion: '19.5.3';
  toVersion: '19.6.1';
  completedBefore: 'paired-controller-wizard';
  rollback: 'separate-cold-checkpoint';
}
export const gitlabPrerequisite: GitLabPrerequisite = {
  kind: 'native-gitlab-cold-checkpoint',
  fromVersion: '19.5.3',
  toVersion: '19.6.1',
  completedBefore: 'paired-controller-wizard',
  rollback: 'separate-cold-checkpoint',
};
export function isGitLabPrerequisite(value: unknown): value is GitLabPrerequisite {
  return isDeepStrictEqual(value, gitlabPrerequisite);
}
function inventory(directory: string): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  function visit(relative: string) {
    const full = path.join(directory, relative),
      stat = fs.lstatSync(full),
      entry: Record<string, unknown> = {
        path: relative,
        mode: stat.mode & 0o7777,
        uid: stat.uid,
        gid: stat.gid,
      };
    if (stat.isSymbolicLink()) {
      entry.type = 'link';
      entry.target = fs.readlinkSync(full);
    } else if (stat.isDirectory()) entry.type = 'directory';
    else if (stat.isFile()) {
      entry.type = 'file';
      entry.size = stat.size;
      entry.sha256 = fileSha(full);
    } else throw Error('gitlab-prerequisite-checkpoint-entry-invalid');
    entries.push(entry);
    if (stat.isDirectory())
      for (const name of fs.readdirSync(full).sort()) visit(path.posix.join(relative, name));
  }
  for (const name of ['gitlab', 'configuration']) visit(name);
  return entries;
}
export class UpgradePrerequisiteService {
  constructor(readonly host: HostInstallService) {}
  verify(root: string, directory: string, sourceRevision: string, securityValue: unknown) {
    const security = record(securityValue);
    ensure(
      security.fromVersion === '19.5.3' && security.toVersion === '19.6.1',
      'gitlab-prerequisite-security-profile-mismatch',
    );
    ensure(
      path.isAbsolute(directory) &&
        fs.realpathSync(directory) === directory &&
        directory.startsWith(fs.realpathSync(root) + path.sep),
      'retained-gitlab-upgrade-checkpoint-required',
    );
    const read = (name: string) => {
      const file = path.join(directory, name),
        stat = fs.lstatSync(file);
      ensure(
        stat.isFile() &&
          !stat.isSymbolicLink() &&
          (stat.mode & 0o077) === 0 &&
          stat.size <= 64 * 1024 ** 2,
        'private-gitlab-upgrade-receipt-required',
      );
      return fs.readFileSync(file);
    };
    const operation = record(JSON.parse(read('operation.json').toString())),
      bytes = read('checkpoint.json'),
      checkpoint = record(JSON.parse(bytes.toString())),
      plan = record(checkpoint.plan);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    ensure(
      operation.format === 'system-gitlab-upgrade-operation-v1' &&
        operation.phase === 'promoted' &&
        operation.checkpointSha256 === digest &&
        operation.toImage === security.toImage &&
        operation.sourceRevision === sourceRevision &&
        revision(sourceRevision) &&
        checkpoint.format === 'system-gitlab-cold-checkpoint-v1' &&
        checkpoint.sourceRevision === sourceRevision &&
        plan.sourceRevision === sourceRevision &&
        imageId(plan.fromImageId) &&
        imageId(plan.toImageId) &&
        plan.fromImageId !== plan.toImageId,
      'completed-native-gitlab-upgrade-required',
    );
    ensure(
      isDeepStrictEqual(checkpoint.entries, inventory(directory)),
      'gitlab-prerequisite-checkpoint-changed',
    );
    const runner = record(plan.runner),
      runnerSecurity = record(security.runner);
    ensure(
      typeof runnerSecurity.toImage === 'string' &&
        imageId(runner.toImageId) &&
        imageId(runner.fromImageId) &&
        runner.toImageId !== runner.fromImageId,
      'gitlab-prerequisite-runner-transition-required',
    );
    const rows: unknown = JSON.parse(
      this.host.run('docker', [
        '--host=unix:///var/run/docker.sock',
        'inspect',
        'system_gitlab_1',
        'runner_docker_1',
      ]),
    );
    ensure(Array.isArray(rows) && rows.length === 2, 'gitlab-prerequisite-services-required');
    const services = rows.map(record);
    for (const [name, id] of [
      ['/system_gitlab_1', plan.toImageId],
      ['/runner_docker_1', runner.toImageId],
    ]) {
      const row = services.find((row) => row.Name === name);
      ensure(
        row && row.Image === id && record(row.State).Running === true,
        'gitlab-prerequisite-running-image-mismatch',
      );
    }
    const version = this.host
      .run(
        'docker',
        [
          '--host=unix:///var/run/docker.sock',
          'exec',
          'system_gitlab_1',
          'cat',
          '/opt/gitlab/embedded/service/gitlab-rails/VERSION',
        ],
        undefined,
        30000,
      )
      .trim();
    ensure(version === '19.6.1', 'gitlab-prerequisite-running-version-mismatch');
    return {
      checkpoint: directory,
      checkpointSha256: digest,
      sourceRevision,
      fromVersion: security.fromVersion,
      toVersion: security.toVersion,
      fromImageId: plan.fromImageId,
      toImageId: plan.toImageId,
      runnerImageId: runner.toImageId,
    };
  }
}
