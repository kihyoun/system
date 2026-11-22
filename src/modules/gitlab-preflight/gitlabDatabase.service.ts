import { Injectable } from '@nestjs/common';
import { parseDocument } from 'yaml';
export interface GitlabDatabasePort {
  command(args: string[], timeout: number, input?: string): string | Promise<string>;
}
export interface GitlabDatabaseSession {
  main: number;
  ci: number;
  databases: number[];
  /** Private connection files stay owned by this session until close is called. */
  command(
    database: number,
    options?: { readOnly?: boolean; interactive?: boolean; applicationName?: string },
  ): string[];
  query(database: number, sql: string): Promise<string>;
  close(): Promise<void>;
}
interface Database {
  database: string;
  host: string;
  port: string;
  parameters: Record<string, string>;
  password?: string;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('gitlab-database-topology-invalid');
  }

  return value as Record<string, unknown>;
}
function databases(source: string): { all: Database[]; main: Database; ci: Database } {
  try {
    if (Buffer.byteLength(source) > 1024 * 1024 || source.includes('<%')) {
      throw Error();
    }

    const document = parseDocument(source, { uniqueKeys: true, merge: true });

    if (document.errors.length) {
      throw Error();
    }

    const production = row(row(document.toJS({ maxAliasCount: 100 })).production);
    const selected = new Map<string, Database>();
    for (const [name, value] of Object.entries(production)) {
      const config = row(value);

      if (config.replica === true) {
        continue;
      }

      if (
        config.adapter !== 'postgresql' ||
        config.url ||
        config.service ||
        (config.schema_search_path && config.schema_search_path !== 'public')
      ) {
        throw Error();
      }

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
      ) {
        throw Error();
      }

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

        if (value === undefined || value === null || value === '') {
          continue;
        }

        if (!['string', 'number', 'boolean'].includes(typeof value)) {
          throw Error();
        }

        const encoded = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);

        if (/[\r\n\0]/.test(encoded) || encoded.trim() !== encoded) {
          throw Error();
        }

        parameters[target] = encoded;
      }

      if (!parameters.user) {
        throw Error();
      }

      const password = config.password;

      if (
        password !== undefined &&
        password !== null &&
        (typeof password !== 'string' || /[\r\n\0]/.test(password))
      ) {
        throw Error();
      }

      selected.set(name, {
        database,
        host,
        port,
        parameters,
        ...(typeof password === 'string' ? { password } : {}),
      });
    }

    if (!selected.has('main') || !selected.has('ci')) {
      throw Error();
    }

    return {
      all: [...new Map([...selected.values()].map((db) => [JSON.stringify(db), db])).values()],
      ci: selected.get('ci')!,
      main: selected.get('main')!,
    };
  } catch {
    throw Error('gitlab-database-topology-invalid');
  }
}

@Injectable()
export class GitlabDatabaseService {
  async open(containerId: string, port: GitlabDatabasePort): Promise<GitlabDatabaseSession> {
    if (!/^[a-f0-9]{64}$/.test(containerId)) {
      throw Error('gitlab-database-container-identity-required');
    }

    const exec = (args: string[], input?: string) =>
      port.command(
        ['exec', ...(input === undefined ? [] : ['-i']), containerId, ...args],
        60,
        input,
      );
    const topology = databases(
      await exec(['cat', '/var/opt/gitlab/gitlab-rails/etc/database.yml']),
    );
    const railsConfiguration = await exec(['cat', '/opt/gitlab/etc/gitlab-rails-rc']);
    const configuredUsers = [
      ...railsConfiguration.matchAll(/^gitlab_user='([a-z_][a-z0-9_-]*)'$/gm),
    ];

    if (configuredUsers.length !== 1) {
      throw Error('gitlab-preflight-service-user-invalid');
    }

    const user = configuredUsers[0][1];
    const uid = (await exec(['id', '-u', user])).trim(),
      gid = (await exec(['id', '-g', user])).trim();

    if (!/^[1-9][0-9]*$/.test(uid) || !/^[1-9][0-9]*$/.test(gid)) {
      throw Error('gitlab-preflight-service-user-invalid');
    }

    const directory = (
      await exec(['mktemp', '-d', '/tmp/system-bootstrapper-gitlab-probe.XXXXXXXXXX'])
    ).trim();

    if (!/^\/tmp\/system-bootstrapper-gitlab-probe\.[A-Za-z0-9]{10}$/.test(directory)) {
      throw Error('gitlab-preflight-private-directory-invalid');
    }

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
      await exec(['chown', '-R', uid + ':' + gid, '--', directory]);

      const indexOf = (db: Database) =>
        topology.all.findIndex((value) => JSON.stringify(value) === JSON.stringify(db));
      let closed = false;
      const command = (
        index: number,
        options: { readOnly?: boolean; interactive?: boolean; applicationName?: string } = {},
      ) => {
        if (closed || !Number.isInteger(index) || index < 0 || index >= topology.all.length) {
          throw Error('gitlab-database-session-invalid');
        }

        if (
          (options.readOnly !== undefined && typeof options.readOnly !== 'boolean') ||
          (options.interactive !== undefined && typeof options.interactive !== 'boolean')
        ) {
          throw Error('gitlab-database-session-options-invalid');
        }

        if (
          options.applicationName !== undefined &&
          !/^[A-Za-z0-9_.:-]{1,63}$/.test(options.applicationName)
        ) {
          throw Error('gitlab-database-application-name-invalid');
        }

        return [
          'exec',
          ...(options.interactive ? ['-i'] : []),
          '--user',
          uid + ':' + gid,
          containerId,
          'env',
          '-i',
          'PATH=/opt/gitlab/embedded/bin:/usr/bin:/bin',
          `HOME=${directory}`,
          'PGOPTIONS=-c statement_timeout=45000' +
            (options.readOnly === false ? '' : ' -c default_transaction_read_only=on'),
          `PGSERVICEFILE=${serviceFile}`,
          '/opt/gitlab/embedded/bin/psql',
          '--no-psqlrc',
          '--no-password',
          '--tuples-only',
          '--no-align',
          '--quiet',
          '--set=ON_ERROR_STOP=1',
          '--dbname',
          `service=database${index}` +
            (options.applicationName ? ` application_name=${options.applicationName}` : ''),
        ];
      };
      return {
        main: indexOf(topology.main),
        ci: indexOf(topology.ci),
        databases: topology.all.map((_, index) => index),
        command,
        query: async (index, sql) =>
          port.command([...command(index), '--command', `BEGIN READ ONLY; ${sql}; COMMIT;`], 60),
        close: async () => {
          if (closed) {
            return;
          }

          await exec(['rm', '-rf', '--', directory]);
          closed = true;
        },
      };
    } catch (error) {
      await exec(['rm', '-rf', '--', directory]);
      throw error;
    }
  }
}
