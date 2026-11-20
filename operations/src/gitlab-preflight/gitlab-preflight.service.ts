import { Injectable } from '@nestjs/common';
import { parseDocument } from 'yaml';

export interface GitlabPreflightPort {
  command(args: string[], timeout: number): string | Promise<string>;
}
export interface GitlabPreflightProof {
  version: string;
  edition: 'CE' | 'EE';
  unfinishedBackgroundMigrations: number;
  runningJobs: number;
}
interface Database {
  database: string;
  host: string;
  port: string;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('gitlab-database-topology-invalid');
  return value as Record<string, unknown>;
}
function databases(source: string): { all: Database[]; ci: Database } {
  try {
    if (Buffer.byteLength(source) > 1024 * 1024 || source.includes('<%')) throw Error();
    const document = parseDocument(source, { uniqueKeys: true, merge: true });
    if (document.errors.length) throw Error();
    const production = row(row(document.toJS({ maxAliasCount: 100 })).production);
    const selected = new Map<string, Database>();
    for (const [name, value] of Object.entries(production)) {
      const config = row(value);
      if (config.replica === true) continue;
      if (
        config.adapter !== 'postgresql' ||
        config.url ||
        config.service ||
        (config.schema_search_path && config.schema_search_path !== 'public')
      )
        throw Error();
      const database = config.database,
        host = config.host,
        port = String(config.port ?? 5432);
      if (
        typeof database !== 'string' ||
        !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(database) ||
        typeof host !== 'string' ||
        !/^(?:\/[A-Za-z0-9_./-]+|[A-Za-z0-9][A-Za-z0-9.-]*)$/.test(host) ||
        host.split('/').includes('..') ||
        !/^[0-9]{1,5}$/.test(port) ||
        Number(port) < 1 ||
        Number(port) > 65535
      )
        throw Error();
      selected.set(name, { database, host, port });
    }
    if (!selected.has('main') || !selected.has('ci')) throw Error();
    return {
      all: [...new Map([...selected.values()].map((db) => [JSON.stringify(db), db])).values()],
      ci: selected.get('ci')!,
    };
  } catch {
    throw Error('gitlab-database-topology-invalid');
  }
}
function count(value: string): number {
  if (!/^(?:0|[1-9][0-9]*)\s*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw Error('upgrade-preflight-refused');
  return Number(value);
}
/** Read-only native probe; the caller retains its existing guardian/lease execution port. */
@Injectable()
export class GitlabPreflightService {
  async probe(containerId: string, port: GitlabPreflightPort): Promise<GitlabPreflightProof> {
    if (!/^[a-f0-9]{64}$/.test(containerId))
      throw Error('gitlab-preflight-container-identity-required');
    const exec = (args: string[]) => port.command(['exec', containerId, ...args], 60);
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
    if (installed.length !== 1) throw Error('gitlab-preflight-package-identity-invalid');
    const [name, packagedVersion] = installed[0].split('\t');
    const match = /^(\d+\.\d+\.\d+)-(ce|ee)\.\d+$/.exec(packagedVersion);
    if (!match || name !== `gitlab-${match[2]}`)
      throw Error('gitlab-preflight-package-identity-invalid');
    const version = (
      await exec(['cat', '/opt/gitlab/embedded/service/gitlab-rails/VERSION'])
    ).trim();
    if (version !== match[1]) throw Error('gitlab-preflight-package-identity-invalid');
    const topology = databases(
      await exec(['cat', '/var/opt/gitlab/gitlab-rails/etc/database.yml']),
    );
    const query = async (db: Database, sql: string) =>
      count(
        await exec([
          'gitlab-psql',
          '--no-psqlrc',
          '--no-password',
          '--tuples-only',
          '--no-align',
          '--set=ON_ERROR_STOP=1',
          '--host',
          db.host,
          '--port',
          db.port,
          '--dbname',
          db.database,
          '--command',
          `BEGIN READ ONLY; ${sql}; COMMIT;`,
          '--quiet',
        ]),
      );
    let unfinishedBackgroundMigrations = 0;
    for (const db of topology.all)
      unfinishedBackgroundMigrations += await query(
        db,
        'SELECT COUNT(*) FROM public.batched_background_migrations WHERE status NOT IN (3, 6)',
      );
    if (!Number.isSafeInteger(unfinishedBackgroundMigrations))
      throw Error('upgrade-preflight-refused');
    const runningJobs = await query(
      topology.ci,
      "SELECT COUNT(*) FROM public.p_ci_builds WHERE type = 'Ci::Build' AND status IN ('preparing', 'running', 'canceling')",
    );
    return {
      version,
      edition: match[2] === 'ce' ? 'CE' : 'EE',
      unfinishedBackgroundMigrations,
      runningJobs,
    };
  }
}
