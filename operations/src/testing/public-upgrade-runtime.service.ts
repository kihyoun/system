import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimeLibraries } from './public-upgrade-transport.service';
/** Prepare the candidate-owned runtime closure for helpers and historical controllers. */
@Injectable()
export class PublicUpgradeRuntimeService {
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
    fs.cpSync('/system/operations', path.join(runtime, 'operations'), {
      recursive: true,
      dereference: true,
    });
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
