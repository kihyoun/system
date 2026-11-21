import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { LifecycleProcess } from '../../common/runtime/managed-child';
import { PROJECT_CI_PROCESS } from './environment-launcher.service';
export const BROWSER_PROBE = Symbol('BROWSER_PROBE');
export interface BrowserProbe {
  ready(url: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}
export class NativeBrowserProbe implements BrowserProbe {
  async ready(url: string): Promise<boolean> {
    try {
      return (await fetch(url, { signal: AbortSignal.timeout(1000) })).status === 200;
    } catch {
      return false;
    }
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
@Injectable()
export class BrowserCheckService {
  constructor(
    @Inject(PROJECT_CI_PROCESS) private readonly process: LifecycleProcess,
    @Inject(BROWSER_PROBE) private readonly probe: BrowserProbe,
  ) {}

  async run(root: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    if (!path.isAbsolute(root)) throw Error('Absolute browser checkout required');
    for (const name of ['build/index.html', 'build-tools/export-configuration.cjs'])
      if (!fs.existsSync(path.join(root, name)) || !fs.statSync(path.join(root, name)).size)
        throw Error('Required source-check artifacts missing.');
    fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
    const log = path.join(root, 'test-results/preview.log');
    fs.writeFileSync(log, '');
    const stop = new AbortController();
    const cancel = () => stop.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    let exited = false;
    const preview = this.process
      .run(
        process.execPath,
        [
          path.join(root, 'node_modules/vite/bin/vite.js'),
          'preview',
          '--host',
          '127.0.0.1',
          '--port',
          '4173',
          '--strictPort',
        ],
        {
          cwd: root,
          env,
          timeout: null,
          signal: stop.signal,
          maxBuffer: 4 * 1024 * 1024,
          output: (chunk) => fs.appendFileSync(log, chunk),
        },
      )
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        exited = true;
      });
    try {
      let ready = false;
      for (let i = 0; i < 100 && !exited && !stop.signal.aborted; i++) {
        if (await this.probe.ready('http://127.0.0.1:4173')) {
          ready = true;
          break;
        }
        await this.probe.sleep(200);
      }
      if (!ready) throw Error('Isolated Wizard preview did not become ready.');
      await this.process.run('npm', ['run', 'test:ci'], {
        cwd: root,
        env: { ...env, WIZARD_BASE_URL: 'http://127.0.0.1:4173' },
        timeout: 540000,
        signal: stop.signal,
        inherit: true,
      });
    } finally {
      stop.abort();
      await preview;
      signal?.removeEventListener('abort', cancel);
    }
  }
}
