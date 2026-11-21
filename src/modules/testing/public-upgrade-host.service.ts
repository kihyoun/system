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
import { parsePublicGitlabInput } from '../host/public-gitlab-prerequisite-entry';
import { PublicGitlabPrerequisiteService } from '../host/public-gitlab-prerequisite.service';
import { release } from '../gitlab-upgrade/types';
import { runnerHelper } from '../gitlab-upgrade/policy';
import { writePrivate } from '../host/install';
import { nativeProcess, type ProcessRunner } from '../../common/runtime/process';

export type PublicUpgradeFixtureOperation =
  | 'initialize'
  | 'restore-original'
  | 'freeze-publication'
  | 'gitlab-previous-selectors'
  | 'save-migrated-public-selection'
  | 'restore-migrated-public-selection'
  | 'candidate-pair-selectors';

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
    readonly gitlab: PublicGitlabPrerequisiteService,
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
      const retained = path.join(directory, 'publication.json');
      if (!prepared && fs.existsSync(retained)) {
        const value = record(JSON.parse(readPrivateInput(retained).toString()));
        prepared = {
          metadata: value.metadata,
          proof: Buffer.from(String(value.proof), 'base64'),
          security: value.security,
        } as ReturnType<PublicUpgradePublicationService['prepare']>;
      }
      prepared ??= this.publication.prepare(checkout, fixture);
      ensure(tag === prepared.metadata.tag, 'candidate-public-asset-mismatch');
      if (filename === 'system-release-' + tag + '.json')
        return new Response(fixtureEncoding(prepared.metadata).toString());
      ensure(filename === prepared.metadata.publicUpgrade.file, 'candidate-public-asset-mismatch');
      return new Response(prepared.proof.toString());
    };
  }

  async execute(
    directory: string,
    input: PublicUpgradeInput | PublicUpgradeFixtureOperation | { gitlab: string[] },
  ) {
    const fixture = this.read(directory);
    if (
      typeof input === 'string' &&
      [
        'save-migrated-public-selection',
        'restore-migrated-public-selection',
        'candidate-pair-selectors',
      ].includes(input)
    )
      return this.selection.migrated(
        directory,
        input as
          | 'save-migrated-public-selection'
          | 'restore-migrated-public-selection'
          | 'candidate-pair-selectors',
        fixture,
      );
    if (typeof input === 'object' && 'gitlab' in input)
      return this.gitlab.execute(parsePublicGitlabInput(input.gitlab));
    if (input === 'freeze-publication') {
      const publication = this.publication.prepare(path.join(directory, 'source'), fixture);
      writePrivate(
        path.join(directory, 'publication.json'),
        Buffer.from(
          JSON.stringify({ ...publication, proof: publication.proof.toString('base64') }),
        ),
      );
      return { retained: true };
    }
    if (input === 'gitlab-previous-selectors') {
      const main = path.join(String(fixture.live), 'configuration/.docker.env'),
        expected = record(fixture.gitlabUpgrade);
      let text = readPrivateInput(main).toString();
      for (const [key, alias, reference] of [
        ['GITLAB_IMAGE', 'candidate-gitlab:under-test', release.fromImage],
        ['GITLAB_RUNNER_IMAGE', 'candidate-runner:under-test', release.runner.fromImage],
      ]) {
        const assignment = new RegExp('^export ' + key + "='" + alias + "'$", 'm');
        ensure(assignment.test(text), 'candidate-previous-service-selector-required');
        text = text.replace(assignment, 'export ' + key + "='" + reference + "'");
      }
      writePrivate(main, Buffer.from(text));
      const root = path.join(String(fixture.live), 'runners');
      for (const pool of fs.readdirSync(root)) {
        if (!/^(?:runner|[a-z0-9][a-z0-9_-]*_runner)$/.test(pool)) continue;
        for (const index of fs.readdirSync(path.join(root, pool))) {
          const config = path.join(root, pool, index, 'config/config.toml');
          if (!fs.existsSync(config)) continue;
          writePrivate(
            config,
            Buffer.from(
              runnerHelper(readPrivateInput(config).toString(), release.runner.fromHelperImage, {
                [release.runner.fromHelperImage]: 'candidate-helper:under-test',
              }),
            ),
          );
        }
      }
      ensure(
        expected.fromImageId && expected.fromRunnerImageId,
        'candidate-previous-image-identities-required',
      );
      return { selected: true };
    }
    if (typeof input === 'string') {
      ensure(
        input === 'initialize' || input === 'restore-original',
        'invalid-fixture-selection-operation',
      );
      return this.selection.execute(directory, input, fixture);
    }
    const certificate = path.join(String(fixture.live), 'host/letsencrypt');
    if (!fs.lstatSync('/etc/letsencrypt', { throwIfNoEntry: false }))
      fs.symlinkSync(certificate, '/etc/letsencrypt');
    return this.upgrade.execute(input);
  }
}
