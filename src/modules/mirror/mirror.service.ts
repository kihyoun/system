import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { eligibility, remoteProtocol } from './policy';
import { MIRROR_PORT, MirrorPort, MirrorContext } from './ports';
@Injectable()
export class MirrorService {
  constructor(@Inject(MIRROR_PORT) private readonly port: MirrorPort) {}

  async publish(context: MirrorContext): Promise<string> {
    const skip = eligibility(context.env);
    if (skip) return 'GitHub backup skipped: ' + skip;
    const env = context.env,
      branch = env.GITHUB_BACKUP_BRANCH || '',
      remote = env.GITHUB_BACKUP_REMOTE || '',
      sha = env.CI_COMMIT_SHA || '';
    const git = (...args: string[]) => this.port.git(args, context);
    const ancestor = (a: string, b: string) => {
      try {
        git('merge-base', '--is-ancestor', a, b);
        return true;
      } catch {
        return false;
      }
    };
    if (!branch) throw Error('backup branch mapping missing');
    try {
      git('check-ref-format', 'refs/heads/' + branch);
    } catch {
      throw Error('invalid backup branch');
    }
    try {
      git('check-ref-format', 'refs/heads/' + env.CI_DEFAULT_BRANCH);
    } catch {
      throw Error('invalid source branch');
    }
    const protocol = remoteProtocol(remote, env.GITHUB_BACKUP_OFFLINE_FIXTURE === '1');
    if (protocol === 'file') {
      if (!fs.existsSync(remote)) throw Error('offline repository missing');
      try {
        if (git('--git-dir=' + remote, 'rev-parse', '--is-bare-repository') !== 'true')
          throw Error();
      } catch {
        throw Error('offline repository must be bare');
      }
    }
    if (!/^[a-f0-9]+$/.test(sha)) throw Error('invalid pinned commit');
    if (![40, 64].includes(sha.length)) throw Error('full pinned commit required');
    if (git('rev-parse', 'HEAD') !== sha) throw Error('checkout differs from pinned commit');
    if (git('cat-file', '-t', sha) !== 'commit') throw Error('pinned object is not a commit');
    const lock = path.resolve(
      context.cwd,
      git('rev-parse', '--git-common-dir'),
      'system-github-backup.lock',
    );
    try {
      fs.mkdirSync(lock);
    } catch {
      throw Error('checkout backup lock held; inspect any interrupted owner before retry');
    }
    const source = 'refs/system-backup/source',
      target = 'refs/system-backup/target';
    const options = ['-c', 'protocol.allow=never', '-c', `protocol.${protocol}.allow=always`];
    const fetchTarget = () =>
      this.port.transport(
        [
          ...options,
          'fetch',
          '--quiet',
          '--no-tags',
          '--',
          remote,
          `+refs/heads/${branch}:${target}`,
        ],
        context,
      );
    try {
      const shallow = git('rev-parse', '--is-shallow-repository') === 'true';
      if (
        !(await this.port.transport(
          [
            'fetch',
            '--quiet',
            '--no-tags',
            ...(shallow ? ['--unshallow'] : []),
            'origin',
            `+refs/heads/${env.CI_DEFAULT_BRANCH}:${source}`,
          ],
          context,
        ))
      )
        throw Error('cannot fetch source default branch within transport deadline');
      if (!ancestor(sha, source))
        throw Error('pinned commit is no longer in the source default branch');
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!(await fetchTarget()))
          throw Error(
            'cannot fetch existing backup branch within deadline; inspect mapping, access and history',
          );
        const tip = git('rev-parse', target);
        if (ancestor(sha, tip)) return 'GitHub backup verified: target contains the pinned commit';
        if (!ancestor(tip, sha))
          throw Error(
            'backup history diverged; manual reconciliation required, nothing overwritten',
          );
        await this.port.transport(
          [
            ...options,
            'push',
            '--no-follow-tags',
            '--quiet',
            '--',
            remote,
            `${sha}:refs/heads/${branch}`,
          ],
          context,
        );
      }
      if (!(await fetchTarget()))
        throw Error('cannot verify backup after bounded retries and transport deadlines');
      if (!ancestor(sha, target))
        throw Error(
          'backup not verified after bounded retries; retry job after inspecting access/history',
        );
      return 'GitHub backup verified: target contains the pinned commit';
    } finally {
      for (const ref of [source, target])
        try {
          git('update-ref', '-d', ref);
        } catch {
          /* Temporary refs never authorize publication. */
        }
      fs.rmdirSync(lock);
    }
  }
}
