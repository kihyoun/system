import { Injectable } from '@nestjs/common';
import { parseDocument } from 'yaml';

export interface GitlabPreflightPort {
  command(args: string[], timeout: number, input?: string): string | Promise<string>;
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
  parameters: Record<string, string>;
  password?: string;
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
      const parameters: Record<string, string> = { dbname: database, host, port };
      for (const [source, target] of Object.entries({
        username: 'user',
        sslmode: 'sslmode',
        sslrootcert: 'sslrootcert',
        sslcert: 'sslcert',
        sslkey: 'sslkey',
        sslpassword: 'sslpassword',
        sslcrl: 'sslcrl',
        sslcompression: 'sslcompression',
        connect_timeout: 'connect_timeout',
        keepalives: 'keepalives',
        keepalives_idle: 'keepalives_idle',
        keepalives_interval: 'keepalives_interval',
        keepalives_count: 'keepalives_count',
        tcp_user_timeout: 'tcp_user_timeout',
        application_name: 'application_name',
      })) {
        const value = config[source];
        if (value === undefined || value === null || value === '') continue;
        if (!['string', 'number', 'boolean'].includes(typeof value)) throw Error();
        const encoded = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
        if (/[\r\n\0]/.test(encoded) || encoded.trim() !== encoded) throw Error();
        parameters[target] = encoded;
      }
      if (!parameters.user) throw Error();
      const password = config.password;
      if (
        password !== undefined &&
        password !== null &&
        (typeof password !== 'string' || /[\r\n\0]/.test(password))
      )
        throw Error();
      selected.set(name, {
        database,
        host,
        port,
        parameters,
        ...(typeof password === 'string' ? { password } : {}),
      });
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
    const directory = (
      await exec(['mktemp', '-d', '/tmp/system-bootstrapper-gitlab-probe.XXXXXXXXXX'])
    ).trim();
    if (!/^\/tmp\/system-bootstrapper-gitlab-probe\.[A-Za-z0-9]{10}$/.test(directory))
      throw Error('gitlab-preflight-private-directory-invalid');
    try {
      const privateFile = async (filename: string, value: string) => {
        await exec(['install', '-m', '0600', '/dev/null', filename]);
        await exec(['dd', `of=${filename}`, 'oflag=nofollow', 'status=none'], value);
      };
      const services: string[] = [];
      for (const [index, db] of topology.all.entries()) {
        const parameters = { ...db.parameters };
        if (db.password !== undefined) {
          const passwordFile = `${directory}/password-${index}`;
          await privateFile(
            passwordFile,
            '*:*:*:*:' + db.password.replace(/([\\:])/g, '\\$1') + '\n',
          );
          parameters.passfile = passwordFile;
        }
        services.push(
          `[database${index}]\n` +
            Object.entries(parameters)
              .map(([key, value]) => `${key}=${value}`)
              .join('\n'),
        );
      }
      const serviceFile = directory + '/service.conf';
      await privateFile(serviceFile, services.join('\n\n') + '\n');
      const query = async (db: Database, sql: string) => {
        const index = topology.all.findIndex(
          (value) => JSON.stringify(value) === JSON.stringify(db),
        );
        if (index < 0) throw Error('gitlab-database-topology-invalid');
        return count(
          await exec([
            'env',
            '-u',
            'PGPASSWORD',
            'PGOPTIONS=-c statement_timeout=45000 -c default_transaction_read_only=on',
            `PGSERVICEFILE=${serviceFile}`,
            '/opt/gitlab/embedded/bin/psql',
            '--no-psqlrc',
            '--no-password',
            '--tuples-only',
            '--no-align',
            '--quiet',
            '--set=ON_ERROR_STOP=1',
            '--dbname',
            `service=database${index}`,
            '--command',
            `BEGIN READ ONLY; ${sql}; COMMIT;`,
          ]),
        );
      };
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
    } finally {
      await exec(['rm', '-rf', '--', directory]);
    }
  }
}
