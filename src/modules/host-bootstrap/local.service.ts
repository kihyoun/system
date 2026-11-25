import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managedChild';
/** Explicit opt-in development host configuration; never enables insecure public registries. */
@Injectable()
export class LocalHostService {
  constructor(
    readonly process: LifecycleProcess = new ManagedChildProcess(),
    readonly systemRoot = '/',
  ) {}

  async prepare(env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    if (process.geteuid?.() !== 0) {
      throw Error('Local host preparation requires root.');
    }

    const directory = path.join(this.systemRoot, 'etc/docker');
    fs.mkdirSync(directory, { recursive: true, mode: 0o755 });
    const filename = path.join(directory, 'daemon.json'),
      temporary = filename + '.bootstrapper.tmp';
    const settings: Record<string, unknown> = fs.existsSync(filename)
      ? JSON.parse(fs.readFileSync(filename, 'utf8'))
      : {};
    const registries = settings['insecure-registries'] ?? [];

    if (!Array.isArray(registries) || !registries.every((value) => typeof value === 'string')) {
      throw Error('Invalid Docker registry configuration.');
    }

    settings['insecure-registries'] = [...new Set([...registries, 'registry.localhost:5050'])];
    fs.writeFileSync(temporary, JSON.stringify(settings, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
      flush: true,
    });
    try {
      await this.process.run('dockerd', ['--validate', '--config-file', temporary], {
        cwd: this.systemRoot,
        env,
        signal,
        timeout: 15000,
      });
      fs.renameSync(temporary, filename);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    await this.process.run('systemctl', ['reload', 'docker'], {
      cwd: this.systemRoot,
      env,
      signal,
      timeout: 15000,
    });
    const hosts = path.join(this.systemRoot, 'etc/hosts');
    let text = fs.readFileSync(hosts, 'utf8');
    const names = new Set(
      text.split('\n').flatMap((line) => line.split('#')[0].trim().split(/\s+/).slice(1)),
    );
    for (const name of ['gitlab.localhost', 'registry.localhost', 'sync.localhost']) {
      if (!names.has(name)) {
        text += '\n127.0.0.1 ' + name;
      }
    }
    fs.writeFileSync(hosts, text.trimEnd() + '\n');
  }
}
