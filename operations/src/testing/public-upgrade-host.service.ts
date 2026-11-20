import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { PublicUpgradeService, type PublicUpgradeInput } from '../host/public-upgrade.service';
import { PublicUpgradeSelectionService } from './public-upgrade-selection.service';
import {
  PublicUpgradePublicationService,
  fixtureEncoding,
} from './public-upgrade-publication.service';
import { requireValue as ensure } from '../host/install';
import { readPrivateInput } from '../host/private-input';
import { record } from '../release/source-identity';
import { nativeProcess, type ProcessRunner } from '../runtime/process';

/** Only the disposable host's absent systemd facts are substituted. */
export const fixtureHostProcess: ProcessRunner = {
  run(binary, args, options) {
    if (binary === 'systemctl') {
      if (JSON.stringify(args) === JSON.stringify(['is-active', 'certbot.timer']))
        return { stdout: 'active\n', stderr: '', status: 0 };
      if (
        JSON.stringify(args) ===
        JSON.stringify(['show', 'certbot.timer', '--property=NextElapseUSecRealtime', '--value'])
      )
        return { stdout: 'fixture-host-timer-scheduled\n', stderr: '', status: 0 };
    }
    return nativeProcess.run(binary, args, options);
  },
};
@Injectable()
export class PublicUpgradeHostService {
  constructor(
    readonly upgrade: PublicUpgradeService,
    readonly selection: PublicUpgradeSelectionService,
    readonly publication: PublicUpgradePublicationService,
  ) {}
  read(directory: string) {
    ensure(path.isAbsolute(directory), 'absolute-fixture-required');
    return record(JSON.parse(readPrivateInput(path.join(directory, 'fixture.json')).toString()));
  }
  transport(directory: string, checkout: string): typeof fetch {
    let prepared: ReturnType<PublicUpgradePublicationService['prepare']> | undefined;
    const fixture = this.read(directory),
      previous = record(fixture.previous);
    const repository = String(record(previous.source).repository)
      .replace(/^https:\/\/github.com\//, '')
      .replace(/\.git$/, '');
    return async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      ensure(
        url.protocol === 'https:' && url.host === 'github.com' && !url.search && !url.hash,
        'candidate-public-repository-mismatch',
      );
      const prefix = '/' + repository + '/releases/download/';
      ensure(url.pathname.startsWith(prefix), 'candidate-public-repository-mismatch');
      const parts = url.pathname.slice(prefix.length).split('/');
      ensure(parts.length === 2, 'candidate-public-asset-mismatch');
      const [tag, filename] = parts;
      if (tag === previous.tag && filename === 'system-release-' + previous.tag + '.json')
        return new Response(fixtureEncoding(previous).toString());
      prepared ??= this.publication.prepare(checkout, fixture);
      ensure(tag === prepared.metadata.tag, 'candidate-public-asset-mismatch');
      if (filename === 'system-release-' + tag + '.json')
        return new Response(fixtureEncoding(prepared.metadata).toString());
      ensure(filename === prepared.metadata.publicUpgrade.file, 'candidate-public-asset-mismatch');
      return new Response(prepared.proof.toString());
    };
  }
  async execute(directory: string, input: PublicUpgradeInput | 'initialize' | 'restore-original') {
    const fixture = this.read(directory);
    if (typeof input === 'string') return this.selection.execute(directory, input, fixture);
    const certificate = path.join(String(fixture.live), 'host/letsencrypt');
    if (!fs.lstatSync('/etc/letsencrypt', { throwIfNoEntry: false }))
      fs.symlinkSync(certificate, '/etc/letsencrypt');
    return this.upgrade.execute(input);
  }
}
