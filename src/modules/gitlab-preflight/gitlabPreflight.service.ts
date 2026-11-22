import { Injectable } from '@nestjs/common';
import { GitlabDatabaseService } from './gitlabDatabase.service';

export interface GitlabPreflightPort {
  command(args: string[], timeout: number, input?: string): string | Promise<string>;
}
export interface GitlabPreflightProof {
  version: string;
  edition: 'CE' | 'EE';
  unfinishedBackgroundMigrations: number;
  runningJobs: number;
}
function count(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)\s*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw Error('upgrade-preflight-refused');
  }

  return Number(value);
}
/** Read-only native probe; the caller retains its existing guardian/lease execution port. */
@Injectable()
export class GitlabPreflightService {
  constructor(private readonly database: GitlabDatabaseService) {}

  async probe(containerId: string, port: GitlabPreflightPort): Promise<GitlabPreflightProof> {
    if (!/^[a-f0-9]{64}$/.test(containerId)) {
      throw Error('gitlab-preflight-container-identity-required');
    }

    const exec = (args: string[], input?: string) =>
      port.command(
        ['exec', ...(input === undefined ? [] : ['-i']), containerId, ...args],
        60,
        input,
      );
    const packages = await exec([
      'dpkg-query',
      '-W',
      '-f=${Package}\t${Version}\t${db:Status-Status}\n',
      'gitlab-*',
    ]);
    const installed = packages
      .trim()
      .split('\n')
      .filter((line) => /^gitlab-(?:ce|ee)\t[^\t]+\tinstalled$/.test(line));

    if (installed.length !== 1) {
      throw Error('gitlab-preflight-package-identity-invalid');
    }

    const [name, packagedVersion] = installed[0].split('\t');
    const match = /^(\d+\.\d+\.\d+)-(ce|ee)\.\d+$/.exec(packagedVersion);

    if (!match || name !== `gitlab-${match[2]}`) {
      throw Error('gitlab-preflight-package-identity-invalid');
    }

    const version = (
      await exec(['cat', '/opt/gitlab/embedded/service/gitlab-rails/VERSION'])
    ).trim();

    if (version !== match[1]) {
      throw Error('gitlab-preflight-package-identity-invalid');
    }

    const session = await this.database.open(containerId, port);
    try {
      let unfinishedBackgroundMigrations = 0;
      for (const index of session.databases) {
        unfinishedBackgroundMigrations += count(
          await session.query(
            index,
            'SELECT COUNT(*) FROM public.batched_background_migrations WHERE status NOT IN (3, 6)',
          ),
        );
      }

      if (!Number.isSafeInteger(unfinishedBackgroundMigrations)) {
        throw Error('upgrade-preflight-refused');
      }

      const runningJobs = count(
        await session.query(
          session.ci,
          "SELECT COUNT(*) FROM public.p_ci_builds WHERE type = 'Ci::Build' AND status IN ('preparing', 'running', 'canceling')",
        ),
      );
      return {
        version,
        edition: match[2] === 'ce' ? 'CE' : 'EE',
        unfinishedBackgroundMigrations,
        runningJobs,
      };
    } finally {
      await session.close();
    }
  }
}
