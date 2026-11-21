import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managed-child';

@Injectable()
export class QuickstartPreflightService {
  constructor(readonly child: LifecycleProcess = new ManagedChildProcess()) {}

  async check(env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    const release = fs.readFileSync('/etc/os-release', 'utf8');
    if (
      process.geteuid?.() !== 0 ||
      process.arch !== 'x64' ||
      !/^ID=ubuntu$/m.test(release) ||
      !/^VERSION_ID="(?:24\.04|26\.04)"$/m.test(release)
    )
      throw Error('Quickstart requires root on Ubuntu 24.04 / 26.04 LTS amd64.');
    if (os.totalmem() < 7.5 * 1024 ** 3) throw Error('Quickstart requires an 8 GiB-class host.');
    for (const [directory, required] of [
      ['/var/lib', 40],
      ['/opt', 1],
    ] as const) {
      const usage = fs.statfsSync(directory);
      if (usage.bavail * usage.bsize < required * 1024 ** 3)
        throw Error(`Insufficient space on ${directory}.`);
    }
    for (const target of ['/etc/system-bootstrapper', '/var/lib/system-bootstrapper', '/system'])
      if (fs.lstatSync(target, { throwIfNoEntry: false }))
        throw Error(`Preserving existing installation state: ${target}`);
    for (const port of [80, 443]) {
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      });
    }
    if ((env.PATH || '').split(':').some((directory) => fs.existsSync(`${directory}/docker`))) {
      for (const args of [
        ['container', 'ls', '--all', '--filter', 'name=^/system_', '--format', '{{.ID}}'],
        ['volume', 'ls', '--filter', 'name=^system_', '--format', '{{.Name}}'],
      ]) {
        const output = await this.child.run(
          'docker',
          ['--host=unix:///var/run/docker.sock', ...args],
          { cwd: '/', env, signal, timeout: 15000 },
        );
        if (output.trim()) throw Error('Existing System Docker state; use the recovery guide.');
      }
    }
  }
}
