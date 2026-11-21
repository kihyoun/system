import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managed-child';
export const PUBLIC_CA_SHA256 = '796f1389bfea13c0ed78f663b765baaff54a508e5483786bd6ece73c5e3e3cbe';
export const RUNTIME_PACKAGES = [
  'docker-cli=29.9.3-r1',
  'docker-cli-compose=5.7.2-r0',
  'docker-cli-buildx=0.38.1-r0',
  'rsync=3.5.2-r1',
  'bash=5.3.9-r1',
  'git=2.54.1-r0',
  'unzip=6.0-r16',
  'curl=8.23.0-r0',
  'zlib=1.4-r0',
];
/** Build image trust only: never implicitly modifies host trust during installation. */
@Injectable()
export class BuildToolsService {
  constructor(
    readonly process: LifecycleProcess = new ManagedChildProcess(),
    readonly systemRoot = '/',
  ) {}

  refreshCa(checkout: string): void {
    const bundle = fs.readFileSync(path.join(checkout, 'config/ca/cacert-2026-10-20.crt'));
    if (crypto.createHash('sha256').update(bundle).digest('hex') !== PUBLIC_CA_SHA256)
      throw Error('Reviewed public CA bundle hash mismatch.');
    const certificates = path.join(this.systemRoot, 'etc/ssl/certs');
    const directory = fs.lstatSync(certificates);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw Error('Public certificate directory required.');
    // Remove obsolete hash links as well as the old bundle: distrusted roots must
    // not remain reachable through OpenSSL's directory store.
    for (const name of fs.readdirSync(certificates)) {
      const filename = path.join(certificates, name),
        stat = fs.lstatSync(filename);
      if (stat.isFile() || stat.isSymbolicLink()) fs.unlinkSync(filename);
    }
    fs.writeFileSync(path.join(certificates, 'ca-certificates.crt'), bundle, { mode: 0o644 });
    const link = path.join(this.systemRoot, 'etc/ssl/cert.pem');
    if (fs.lstatSync(link, { throwIfNoEntry: false })) fs.unlinkSync(link);
    fs.symlinkSync('certs/ca-certificates.crt', link);
  }

  async installRuntime(
    checkout: string,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<void> {
    const run = (binary: string, args: string[], timeout = 180000) =>
      this.process.run(binary, args, { cwd: checkout, env, signal, timeout });
    if (
      (await run(process.execPath, ['--version'])).trim() !== 'v24.22.0' ||
      (await run('npm', ['--version'])).trim() !== '11.19.1'
    )
      throw Error('Pinned Node and npm runtime required.');
    await run('apk', ['add', '--no-cache', ...RUNTIME_PACKAGES], 900000);
    this.refreshCa(checkout);
    for (const args of [['--version'], ['compose', 'version'], ['buildx', 'version']])
      await run('docker', args);
  }
}
