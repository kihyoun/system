import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileLock } from '../../common/runtime/file-lock';
import { spawnSync } from 'node:child_process';
import { runtimeLibraries } from './public-upgrade-transport.service';
/** Prepare the candidate-owned runtime closure for helpers and historical controllers. */
@Injectable()
export class PublicUpgradeRuntimeService {
  copyApplication(source: string, runtime: string): void {
    if (!path.isAbsolute(source) || !path.isAbsolute(runtime))
      throw Error('absolute-fixture-required');
    // Relocate the complete native application, including its offline dependency
    // closure and the release profile loaded by the full host module.
    for (const name of ['dist', 'node_modules', 'assets'])
      fs.cpSync(path.join(source, name), path.join(runtime, name), {
        recursive: true,
        dereference: true,
      });
    fs.copyFileSync(
      path.join(source, 'package.json'),
      path.join(runtime, 'package.json'),
      fs.constants.COPYFILE_EXCL,
    );
    const gitlab = path.join(runtime, 'config/gitlab');
    fs.mkdirSync(gitlab, { recursive: true, mode: 0o755 });
    fs.copyFileSync(
      path.join(source, 'config/gitlab/security-release.json'),
      path.join(gitlab, 'security-release.json'),
      fs.constants.COPYFILE_EXCL,
    );
  }

  verifyHost(): void {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'public-host-runtime-'));
    try {
      // Exercise the interfaces used by shared host/storage services, not just
      // command presence: BusyBox accepts some names but not the GNU options.
      for (const [binary, args] of [
        ['git', ['--version']],
        ['docker', ['--version']],
        ['unzip', ['-v']],
        ['mountpoint', ['-q', '--', '/']],
        ['realpath', ['-e', '--', directory]],
        ['realpath', ['-m', '--', path.join(directory, 'absent')]],
        ['findmnt', ['-rn', '-o', 'TARGET', '--target', directory]],
        ['stat', ['-f', '-c', '%T', '--', directory]],
        ['df', ['-B1', '--output=avail', '--', directory]],
        ['du', ['-sb', '--', directory]],
      ] as const) {
        const result = spawnSync(binary, [...args], { timeout: 10000, encoding: 'utf8' });
        if (result.error || result.status !== 0)
          throw Error('candidate-public-host-runtime-unavailable');
      }
      const release = fileLock(path.join(directory, 'lease'));
      release();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  prepare(fixture: string) {
    if (!path.isAbsolute(fixture)) throw Error('absolute-fixture-required');
    const runtime = path.join(fixture, 'runtime');
    fs.mkdirSync(runtime, { mode: 0o700 });
    const copy = (source: string, destination: string) => {
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      fs.copyFileSync(fs.realpathSync(source), destination, fs.constants.COPYFILE_EXCL);
    };
    copy(process.execPath, path.join(runtime, 'node'));
    for (const source of runtimeLibraries) copy(source, path.join(runtime, source));
    // Confirm the exact candidate's dynamic dependencies; never silently assume
    // that a changed upstream Node build still fits the declared runtime closure.
    const linked = spawnSync(runtimeLibraries[0], ['--list', process.execPath], {
      encoding: 'utf8',
    });
    if (
      linked.status !== 0 ||
      /not found|Error loading|Error relocating/.test(linked.stdout + linked.stderr)
    )
      throw Error('candidate-node-runtime-unresolved');
    const resolved = [...linked.stdout.matchAll(/=>\s+(\/[^\s]+)/g)].map((match) => match[1]);
    const allowed = new Set([...runtimeLibraries.map((file) => fs.realpathSync(file))]);
    if (resolved.some((file) => !allowed.has(fs.realpathSync(file))))
      throw Error('candidate-node-runtime-changed');
    for (const name of ['docker', 'docker-compose']) {
      copy('/usr/bin/' + name, path.join(fixture, name + '.native'));
      fs.chmodSync(path.join(fixture, name + '.native'), 0o755);
    }
    this.copyApplication('/system', runtime);
    for (const [name, file] of [
      ['docker', 'docker'],
      ['docker-compose', 'docker'],
      ['findmnt', 'findmnt'],
    ]) {
      const source = path.join(fixture, 'source/tests/e2e/public-upgrade-' + file + '.js');
      fs.chmodSync(source, 0o755);
      fs.symlinkSync(source, path.join(fixture, 'bin', name));
    }
    fs.chmodSync(path.join(runtime, 'node'), 0o755);
    fs.chmodSync(runtime, 0o755);
  }

  write(filename: string, input: Buffer) {
    fs.writeFileSync(filename, input, { mode: 0o600 });
  }
}
