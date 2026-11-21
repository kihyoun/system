// Keep public submodule coordinates portable while allowing a private primary.
import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { ProcessRunner } from '../../common/runtime/process';
import { SOURCE_PROCESS } from './source-preparation.service';

export function selection(environment: NodeJS.ProcessEnv) {
  const value = environment.WIZARD_PRIMARY_REPOSITORY_URL;
  if (!value) return null;
  const target = new URL(value),
    server = new URL(environment.CI_SERVER_URL || '');
  if (
    target.protocol !== 'https:' ||
    server.protocol !== 'https:' ||
    target.origin !== server.origin ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    !/^\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.git)?$/.test(target.pathname) ||
    target.pathname.split('/').some((part) => part === '.' || part === '..') ||
    !environment.CI_JOB_TOKEN
  )
    throw Error('Use a same-instance HTTPS Wizard repository selector and CI job token.');
  return { url: target.href, origin: server.origin, token: environment.CI_JOB_TOKEN };
}
@Injectable()
export class WizardSourcePreparationService {
  constructor(@Inject(SOURCE_PROCESS) private readonly process: ProcessRunner) {}

  prepare(environment: NodeJS.ProcessEnv, directory: string): string {
    const git = (args: string[], env = environment) =>
      this.process
        .run('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
          cwd: directory,
          env,
          timeout: 30000,
          maxBuffer: 1024 * 1024,
        })
        .stdout.trim();
    const entry = git(['ls-tree', 'HEAD', '--', 'wizard']);
    if (/^040000 tree [a-f0-9]{40}\twizard$/.test(entry)) {
      git(['diff', '--exit-code', 'HEAD', '--', 'wizard']);
      return git(['rev-parse', 'HEAD']);
    }
    const selected = selection(environment);
    const row = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(entry);
    if (!row) throw Error('The checkout must pin exactly one Wizard gitlink.');
    if (git(['config', '--file', '.gitmodules', '--get', 'submodule.wizard.path']) !== 'wizard')
      throw Error('Wizard submodule path changed.');
    let env = environment;
    const args: string[] = [];
    if (selected) {
      // Process-local config avoids credentials in URLs, argv, files or logs.
      // Disable inherited credential helpers and restrict this auth to our origin.
      env = {
        ...environment,
        GIT_CONFIG_COUNT: '3',
        GIT_CONFIG_KEY_0: 'credential.helper',
        GIT_CONFIG_VALUE_0: '',
        GIT_CONFIG_KEY_1: 'http.' + selected.origin + '/.extraHeader',
        GIT_CONFIG_VALUE_1:
          'Authorization: Basic ' +
          Buffer.from('gitlab-ci-token:' + selected.token).toString('base64'),
        GIT_CONFIG_KEY_2: 'http.followRedirects',
        GIT_CONFIG_VALUE_2: 'false',
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
      };
      args.push('-c', 'submodule.wizard.url=' + selected.url);
      // update --init only uses that selector for a fresh clone. A previously
      // initialized/deinitialized submodule can retain its old origin in Git's
      // module cache; repair all cached fetch URLs before any possible fetch.
      const cache = git(['rev-parse', '--git-path', 'modules/wizard']);
      const directories = new Set(
        fs.existsSync(path.resolve(directory, cache)) ? [path.resolve(directory, cache)] : [],
      );
      if (fs.existsSync(path.join(directory, 'wizard', '.git')))
        directories.add(git(['-C', 'wizard', 'rev-parse', '--absolute-git-dir']));
      for (const directory of directories)
        git([
          '--git-dir=' + directory,
          'config',
          '--replace-all',
          'remote.origin.url',
          selected.url,
        ]);
    }
    git([...args, 'submodule', 'update', '--init', '--checkout', '--', 'wizard'], env);
    if (git(['-C', 'wizard', 'rev-parse', 'HEAD']) !== row[1])
      throw Error('Wizard checkout differs from its exact gitlink.');
    return row[1];
  }
}
