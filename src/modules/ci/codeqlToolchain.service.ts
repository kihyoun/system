import fs from 'node:fs';
import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managedChild';
const archiveSha256 = 'da3e952c7fe978a0b6b93e75d9cbabbdf8535667ca0810bd4b2ae37bc840ffee';
/** Install the reviewed upstream scanner into its disposable build image. */
@Injectable()
export class CodeqlToolchainService {
  constructor(private readonly process: LifecycleProcess = new ManagedChildProcess()) {}

  async install(root: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    if (root !== '/runtime' || env.SYSTEM_CODEQL_IMAGE_BUILD !== '1') {
      throw Error('explicit-codeql-image-build-required');
    }

    const run = (binary: string, args: string[], timeout: number | null = null) =>
      this.process.run(binary, args, { cwd: root, env, signal, timeout, inherit: true });
    await run('apt-get', ['update']);
    await run('apt-get', [
      'install',
      '-y',
      '--no-install-recommends',
      'ca-certificates',
      'curl',
      'zstd',
    ]);
    fs.rmSync('/var/lib/apt/lists', { recursive: true, force: true });
    const archive = '/tmp/codeql.tar.zst';
    try {
      await run(
        'curl',
        [
          '--fail',
          '--location',
          '--retry',
          '3',
          '--max-time',
          '600',
          'https://github.com/github/codeql-action/releases/download/codeql-bundle-v2.27.4/codeql-bundle-linux64.tar.zst',
          '--output',
          archive,
        ],
        610000,
      );
      const digest = crypto.createHash('sha256');
      for await (const chunk of fs.createReadStream(archive)) {
        digest.update(chunk as Buffer);
      }

      if (digest.digest('hex') !== archiveSha256) {
        throw Error('pinned-codeql-bundle-sha256-mismatch');
      }

      await run('tar', ['--zstd', '-xf', archive, '-C', '/opt']);
      await run('chmod', ['-R', 'a+rX', '/opt/codeql']);
      fs.mkdirSync('/reports', { recursive: true });
      await run('chown', ['node:node', '/reports']);
    } finally {
      fs.rmSync(archive, { force: true });
    }
  }
}
