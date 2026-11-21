import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managed-child';
@Injectable()
export class UbuntuHostService {
  constructor(
    readonly process: LifecycleProcess = new ManagedChildProcess(),
    readonly systemRoot = '/',
  ) {}

  async install(input: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    if (process.geteuid?.() !== 0) throw Error('Host installation requires root.');
    const release: Record<string, string> = {};
    for (const line of fs
      .readFileSync(path.join(this.systemRoot, 'etc/os-release'), 'utf8')
      .split('\n')) {
      const match = /^([A-Z_]+)=(?:"([^"\\]*)"|'([^']*)'|([^\s#]*))$/.exec(line);
      if (match) release[match[1]] = match[2] ?? match[3] ?? match[4];
    }
    const suite = release.UBUNTU_CODENAME || release.VERSION_CODENAME;
    if (release.ID !== 'ubuntu' || !/^[a-z][a-z0-9-]*$/.test(suite || ''))
      throw Error('Supported Ubuntu release required.');
    const env = { ...input, DEBIAN_FRONTEND: 'noninteractive' };
    const run = (binary: string, args: string[]) =>
      this.process.run(binary, args, { cwd: this.systemRoot, env, signal, timeout: 1800000 });
    await run('apt-get', ['update']);
    await run('apt-get', ['install', '-y', 'zsh', 'unzip', 'git', 'ca-certificates', 'curl']);
    const keys = path.join(this.systemRoot, 'etc/apt/keyrings');
    fs.mkdirSync(keys, { recursive: true, mode: 0o755 });
    const key = path.join(keys, 'docker.asc');
    await run('curl', ['-fsSL', 'https://download.docker.com/linux/ubuntu/gpg', '-o', key]);
    fs.chmodSync(key, 0o644);
    const architecture = (await run('dpkg', ['--print-architecture'])).trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(architecture)) throw Error('Invalid host architecture.');
    const sources = path.join(this.systemRoot, 'etc/apt/sources.list.d');
    fs.mkdirSync(sources, { recursive: true, mode: 0o755 });
    fs.writeFileSync(
      path.join(sources, 'docker.sources'),
      `Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: ${suite}\nComponents: stable\nArchitectures: ${architecture}\nSigned-By: /etc/apt/keyrings/docker.asc\n`,
      { mode: 0o644 },
    );
    await run('apt-get', ['update']);
    await run('apt-get', [
      'install',
      '-y',
      'docker-ce',
      'docker-ce-cli',
      'containerd.io',
      'docker-buildx-plugin',
      'docker-compose-plugin',
    ]);
    await run('systemctl', ['enable', '--now', 'docker']);
    await run('docker', ['--host=unix:///var/run/docker.sock', 'version']);
    await run('docker', ['compose', 'version']);
    await run('docker', ['--host=unix:///var/run/docker.sock', 'run', '--rm', 'hello-world']);
  }
}
