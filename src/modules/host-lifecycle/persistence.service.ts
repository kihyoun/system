import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managedChild';

export function storageEnvironment(input: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...input };
  env.PERSISTENCE_MODE ||= env.PERSISTENT_MOUNT ? 'volume' : 'local';

  if (env.PERSISTENCE_MODE === 'local') {
    env.PERSISTENT_MOUNT ||= '/';
    env.PERSISTENT_DIR ||= '/var/lib/system-bootstrapper/platform';
    env.PERSISTENT_UUID ||= '';
  }

  for (const key of ['SEED_DIR', 'SEED_MOUNT', 'SEED_UUID']) {
    env[key] ||= '';
  }
  return env;
}
function requireStorage(value: unknown, message: string): asserts value {
  if (!value) {
    throw new Error('Persistent storage: ' + message);
  }
}
const directories = [
  'configuration',
  'wizard-public',
  'templates',
  'synctemplates',
  'ssl',
  'ssl/acme-http01',
  'runners',
  'host/letsencrypt',
  'gitlab/config',
  'gitlab/logs',
  'gitlab/data',
];

@Injectable()
export class HostPersistenceService {
  constructor(private readonly runner: LifecycleProcess = new ManagedChildProcess()) {}

  async prepare(
    input: NodeJS.ProcessEnv,
    uid = process.geteuid?.(),
    signal?: AbortSignal,
  ): Promise<NodeJS.ProcessEnv> {
    const env = storageEnvironment(input);
    const run = async (command: string, args: string[]) =>
      (
        await this.runner.run(command, args, { env, cwd: process.cwd(), signal, timeout: 15000 })
      ).trim();
    const mount = env.PERSISTENT_MOUNT,
      data = env.PERSISTENT_DIR;
    requireStorage(uid === 0, 'run startup as root.');
    requireStorage(
      typeof mount === 'string' && mount.startsWith('/'),
      'mount path must be absolute.',
    );
    requireStorage(typeof data === 'string' && data.startsWith('/'), 'data path must be absolute.');
    requireStorage(
      ['local', 'volume'].includes(env.PERSISTENCE_MODE!),
      'invalid persistence mode.',
    );
    requireStorage(
      env.PERSISTENCE_MODE === 'local' || mount !== '/',
      'volume mode requires a separate filesystem.',
    );
    requireStorage(fs.statSync(mount).isDirectory(), 'mountpoint does not exist.');
    await run('mountpoint', ['-q', '--', mount]);
    const canonicalMount = await run('realpath', ['-e', '--', mount]);
    const canonicalData = await run('realpath', ['-m', '--', data]);
    requireStorage(
      canonicalData !== '/' && canonicalData.startsWith(canonicalMount.replace(/\/$/, '') + '/'),
      'data directory must be beneath the selected mount.',
    );
    const inspect = (field: string, target: string) =>
      run('findmnt', ['-rn', '-o', field, '--target', target]);
    requireStorage(
      (await inspect('TARGET', canonicalMount)) === canonicalMount,
      'mountpoint mismatch.',
    );

    if (env.PERSISTENCE_MODE === 'volume') {
      requireStorage(
        (await inspect('MAJ:MIN', canonicalMount)) !== (await inspect('MAJ:MIN', '/')),
        'storage resolves to the root filesystem.',
      );
    } else {
      requireStorage(canonicalMount === '/', 'local mode must select the system filesystem.');
    }

    if (env.PERSISTENT_UUID) {
      requireStorage(
        (await inspect('UUID', canonicalMount)) === env.PERSISTENT_UUID,
        'filesystem UUID mismatch.',
      );
    }

    let existing = canonicalData;
    while (!fs.existsSync(existing)) {
      existing = path.dirname(existing);
    }
    requireStorage(
      (await inspect('TARGET', existing)) === canonicalMount,
      'data directory resolves to another filesystem.',
    );
    requireStorage(canonicalData === data.replace(/\/$/, ''), 'live data path must be canonical.');
    requireStorage(
      !['msdos', 'vfat', '9p', 'drvfs', 'fuseblk'].includes(
        await run('stat', ['-f', '-c', '%T', '--', existing]),
      ),
      'live data requires a POSIX filesystem.',
    );
    const minimum = env.PERSISTENCE_MIN_FREE_BYTES || '1073741824';
    requireStorage(/^\d+$/.test(minimum), 'invalid free-space requirement.');
    const available = (await run('df', ['-B1', '--output=avail', '--', existing]))
      .split('\n')
      .at(-1)
      ?.trim();
    requireStorage(
      available && /^\d+$/.test(available) && BigInt(available) >= BigInt(minimum),
      'insufficient free space for live data.',
    );
    fs.accessSync(existing, fs.constants.W_OK | fs.constants.X_OK);
    for (const relative of directories) {
      const target = path.join(canonicalData, relative);
      requireStorage((await run('realpath', ['-m', '--', target])) === target, 'unsafe data path.');
      const stat = fs.lstatSync(target, { throwIfNoEntry: false });

      if (stat) {
        requireStorage(
          stat.isDirectory() &&
            !stat.isSymbolicLink() &&
            (await inspect('TARGET', target)) === canonicalMount,
          'unsafe data directory or nested mount.',
        );
      }
    }
    const marker = path.join(canonicalData, '.system-bootstrapper-volume');
    const markerStat = fs.lstatSync(marker, { throwIfNoEntry: false });

    if (markerStat) {
      requireStorage(
        markerStat.isFile() &&
          !markerStat.isSymbolicLink() &&
          fs.readFileSync(marker, 'utf8').replace(/\n+$/, '') ===
            'system-bootstrapper-persistence-v1',
        'invalid volume marker.',
      );
    }

    if (env.PERSISTENCE_CHECK_ONLY === '1') {
      return env;
    }

    for (const relative of directories) {
      fs.mkdirSync(path.join(canonicalData, relative), { recursive: true, mode: 0o700 });
    }
    fs.chmodSync(path.join(canonicalData, 'configuration'), 0o700);
    fs.chmodSync(path.join(canonicalData, 'wizard-public'), 0o755);
    const ssl = path.join(canonicalData, 'ssl');
    fs.chmodSync(ssl, (fs.statSync(ssl).mode & 0o777) | 0o111);
    fs.chmodSync(path.join(ssl, 'acme-http01'), 0o755);
    const temporary = marker + '.' + crypto.randomBytes(12).toString('hex');
    try {
      fs.writeFileSync(temporary, 'system-bootstrapper-persistence-v1\n', {
        flag: 'wx',
        mode: 0o600,
      });
      fs.renameSync(temporary, marker);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    return env;
  }
}
