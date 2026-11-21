import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { ManagedChildProcess, type LifecycleProcess } from '../runtime/managed-child';
import { HostInstallService, privateFile, reference } from '../host/install';
import { readNpmReceipt } from '../release/npm-identity';
import { QuickstartPreflightService } from './quickstart-preflight.service';
import { UbuntuHostService } from './ubuntu.service';

/** Post-Node fresh installation; every mutation belongs to the accepted CLI runtime. */
@Injectable()
export class QuickstartService {
  constructor(
    readonly child: LifecycleProcess = new ManagedChildProcess(),
    readonly ubuntu = new UbuntuHostService(),
    readonly installer = new HostInstallService(),
    readonly packageRoot = path.resolve(__dirname, '../..'),
    readonly request: typeof fetch = fetch,
    readonly preflight = new QuickstartPreflightService(),
  ) {}
  async install(
    checkout: string,
    manifest: string,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<void> {
    privateFile(manifest);
    const selected = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const source = selected.source,
      receipt = readNpmReceipt(selected.quickstart?.cli);
    if (
      selected.format !== 'system-accepted-release-v1' ||
      source?.sourceLayout !== 'system-monorepo-v1' ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.git$/.test(
        source.repository || '',
      ) ||
      !/^[a-f0-9]{40}$/.test(source.wizardSourceTree || '') ||
      receipt.version !== selected.version ||
      receipt.sourceRevision !== source.revision ||
      receipt.sourceTree !== source.tree ||
      selected.acceptance?.requiredChecksPassed !== true ||
      selected.acceptance?.controllerWizardSameAttempt !== true
    )
      throw Error('Accepted same-source CLI and monorepo release required.');
    const controller = reference(selected.images?.controller?.reference),
      wizard = reference(selected.images?.wizard?.reference);
    if (!path.isAbsolute(checkout) || fs.lstatSync(checkout, { throwIfNoEntry: false }))
      throw Error('Fresh absolute checkout required.');
    await this.preflight.check(env, signal);
    await this.ubuntu.install(env, signal);
    const run = (binary: string, args: string[]) =>
      this.child.run(binary, args, { cwd: '/', env, signal, timeout: 1800000 });
    // Hooks are disabled for both network fetch and checkout of the accepted commit.
    await run('git', [
      '-c',
      'core.hooksPath=/dev/null',
      'clone',
      '--no-checkout',
      '--',
      source.repository,
      checkout,
    ]);
    await run('git', [
      '-C',
      checkout,
      '-c',
      'core.hooksPath=/dev/null',
      'checkout',
      '--detach',
      source.revision,
    ]);
    const git = async (...args: string[]) => (await run('git', ['-C', checkout, ...args])).trim();
    if (
      (await git('rev-parse', 'HEAD')) !== source.revision ||
      (await git('rev-parse', 'HEAD^{tree}')) !== source.tree ||
      (await git('ls-tree', 'HEAD', 'wizard')) !== `040000 tree ${source.wizardSourceTree}\twizard`
    )
      throw Error('Accepted source tree mismatch.');
    // The package was hash-checked before its first execution. Reuse those exact
    // compiled bytes and bundled dependencies, without a second build/download.
    for (const name of ['dist', 'node_modules', 'assets']) {
      const destination = path.join(checkout, 'operations', name),
        origin = path.join(this.packageRoot, name);
      if (
        fs.lstatSync(destination, { throwIfNoEntry: false }) ||
        !fs.statSync(origin).isDirectory()
      )
        throw Error('Fresh compiled runtime destination required.');
      fs.cpSync(origin, destination, { recursive: true, errorOnExist: true, force: false });
    }
    await this.installer.install(
      {
        controller,
        wizard,
        persistenceEnv: '/etc/system-bootstrapper/persistence.env',
        releaseMetadata: manifest,
      },
      checkout,
    );
    await this.ready(signal);
  }
  async ready(signal?: AbortSignal, timeout = 180000): Promise<void> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      try {
        const bounded = AbortSignal.any([
          AbortSignal.timeout(Math.min(5000, Math.max(1, deadline - Date.now()))),
          ...(signal ? [signal] : []),
        ]);
        const configuration = await this.request('http://127.0.0.1/configuration', {
          signal: bounded,
          redirect: 'error',
        });
        const reader = configuration.body?.getReader();
        let size = 0,
          html = '';
        try {
          if (reader)
            while (true) {
              const row = await reader.read();
              if (row.done) break;
              size += row.value.length;
              if (size > 1024 * 1024) throw Error('Readiness response too large.');
              html += Buffer.from(row.value).toString();
            }
        } finally {
          await reader?.cancel();
        }
        const sync = await this.request('http://127.0.0.1/sync/status', {
          signal: bounded,
          redirect: 'error',
        });
        await sync.body?.cancel();
        if (configuration.status === 200 && /<html/i.test(html) && sync.status === 401) return;
      } catch {
        signal?.throwIfAborted();
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, Math.min(2000, Math.max(1, deadline - Date.now())));
        function done() {
          clearTimeout(timer);
          signal?.removeEventListener('abort', done);
          resolve();
        }
        signal?.addEventListener('abort', done, { once: true });
      });
    }
    throw Error(
      'Wizard/Sync readiness timed out; preserve installed state and inspect native Docker logs.',
    );
  }
}
