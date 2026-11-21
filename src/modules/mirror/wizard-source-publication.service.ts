// Publish an exact System gitlink before mirroring its parent commit. This is
// separate from the Wizard's default-branch publisher and never advances it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { MIRROR_PORT, type MirrorPort, type MirrorContext } from './ports';
const revision = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const number = (value: unknown) =>
  /^[1-9][0-9]*$/.test(String(value)) && Number.isSafeInteger(Number(value));
type SourceGit = (args: string[]) => string;
export interface WizardSourceReceipt {
  format: string;
  projectId: number;
  pipelineId: number;
  publicationJobId: number;
  systemRevision: string;
  wizardRevision: string;
  repository: string;
  ref: string;
}

// Read the committed layout, never a working-tree path or an obsolete selector.
export function sourceKind(env: NodeJS.ProcessEnv, git: SourceGit): 'tree' | 'gitlink' {
  if (!revision(env.CI_COMMIT_SHA) || git(['rev-parse', 'HEAD']) !== env.CI_COMMIT_SHA)
    throw Error('Source publication checkout does not match the pipeline.');
  const row = git(['ls-tree', 'HEAD', '--', 'wizard']);
  if (/^040000 tree [a-f0-9]{40}\twizard$/.test(row)) return 'tree';
  if (/^160000 commit [a-f0-9]{40}\twizard$/.test(row)) return 'gitlink';
  throw Error('An exact Wizard source tree or historical gitlink is required.');
}

export function publicationContext(
  env: NodeJS.ProcessEnv,
  git: SourceGit,
): WizardSourceReceipt | null {
  if (
    env.WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED !== 'true' ||
    env.GITHUB_BACKUP_ENABLED !== 'true' ||
    env.GITLAB_CI !== 'true' ||
    env.CI_PIPELINE_SOURCE !== 'push' ||
    env.CI_COMMIT_TAG ||
    !env.CI_DEFAULT_BRANCH ||
    env.CI_COMMIT_BRANCH !== env.CI_DEFAULT_BRANCH ||
    env.CI_COMMIT_REF_PROTECTED !== 'true' ||
    !env.CI_PROJECT_PATH ||
    env.CI_PROJECT_PATH !== env.GITHUB_BACKUP_SOURCE_PROJECT ||
    !revision(env.CI_COMMIT_SHA) ||
    !['CI_PROJECT_ID', 'CI_PIPELINE_ID', 'CI_JOB_ID'].every((key) => number(env[key]))
  )
    throw Error(
      'Wizard source publication requires an enabled protected System default-branch push.',
    );
  if (sourceKind(env, git) === 'tree') return null;
  const row = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(
    git(['ls-tree', 'HEAD', '--', 'wizard']),
  );
  if (
    !row ||
    git(['config', '--blob', 'HEAD:.gitmodules', '--get', 'submodule.wizard.path']) !== 'wizard'
  )
    throw Error('An exact Wizard gitlink is required.');
  const repository = git(['config', '--blob', 'HEAD:.gitmodules', '--get', 'submodule.wizard.url']);
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)\.git$/.exec(
    repository,
  );
  if (
    !match ||
    ['.', '..'].includes(match[2]) ||
    env.WIZARD_GITHUB_BACKUP_REMOTE !== `git@github.com:${match[1]}/${match[2]}.git`
  )
    throw Error('The approved Wizard destination must match the public submodule mapping.');
  const origin = new URL(env.CI_SERVER_URL || ''),
    source = new URL(env.WIZARD_PRIMARY_REPOSITORY_URL || '');
  if (
    origin.protocol !== 'https:' ||
    source.protocol !== 'https:' ||
    source.origin !== origin.origin ||
    source.username ||
    source.password ||
    source.search ||
    source.hash ||
    !/^\/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.git$/.test(source.pathname) ||
    source.pathname.split('/').some((part) => ['.', '..'].includes(part)) ||
    typeof env.CI_JOB_TOKEN !== 'string' ||
    !env.CI_JOB_TOKEN ||
    /[\r\n]/.test(env.CI_JOB_TOKEN)
  )
    throw Error('An approved same-instance Wizard source and job token are required.');
  return {
    format: 'system-wizard-source-publication-v1',
    projectId: Number(env.CI_PROJECT_ID),
    pipelineId: Number(env.CI_PIPELINE_ID),
    publicationJobId: Number(env.CI_JOB_ID),
    systemRevision: env.CI_COMMIT_SHA,
    wizardRevision: row[1],
    repository,
    ref: 'refs/heads/system-release/' + row[1],
  };
}

export function isolatedEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'Never',
  };
  for (const key of Object.keys(result))
    if (
      /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(key) ||
      [
        'GIT_DIR',
        'GIT_WORK_TREE',
        'GIT_INDEX_FILE',
        'GIT_ASKPASS',
        'SSH_ASKPASS',
        'SSH_ASKPASS_REQUIRE',
      ].includes(key)
    )
      delete result[key];
  result.GIT_CONFIG_COUNT = '2';
  result.GIT_CONFIG_KEY_0 = 'credential.helper';
  result.GIT_CONFIG_VALUE_0 = '';
  result.GIT_CONFIG_KEY_1 = 'http.followRedirects';
  result.GIT_CONFIG_VALUE_1 = 'false';
  return result;
}

@Injectable()
export class WizardSourcePublicationService {
  constructor(@Inject(MIRROR_PORT) private readonly port: MirrorPort) {}

  sourceKind(context: MirrorContext): 'tree' | 'gitlink' {
    const env = isolatedEnvironment(context.env);
    return sourceKind(context.env, (args) => this.port.git(args, { ...context, env }));
  }

  async publish(context: MirrorContext): Promise<WizardSourceReceipt | null> {
    const { env, cwd } = context;
    const clean = isolatedEnvironment(env);
    const run = (args: string[], environment: NodeJS.ProcessEnv, directory: string) =>
      this.port.git(args, { ...context, env: environment, cwd: directory });
    const git = (args: string[]) => run(args, clean, cwd);
    const transport = async (args: string[], environment: NodeJS.ProcessEnv) =>
      (await this.port.transport(args, { ...context, env: environment })) ? 0 : 1;
    const receipt = publicationContext(env, git);
    if (receipt === null) return null;
    const privateEnv = {
      ...clean,
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_2: 'http.' + new URL(env.CI_SERVER_URL || '').origin + '/.extraHeader',
      GIT_CONFIG_VALUE_2:
        'Authorization: Basic ' +
        Buffer.from('gitlab-ci-token:' + env.CI_JOB_TOKEN).toString('base64'),
    };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'system-wizard-source-'));
    fs.chmodSync(directory, 0o700);
    const bare = path.join(directory, 'source.git');
    const options = ['--git-dir=' + bare, '-c', 'protocol.allow=never'];
    try {
      run(['init', '--bare', bare], clean, cwd);
      if (
        (await transport(
          [
            ...options,
            '-c',
            'protocol.https.allow=always',
            'fetch',
            '--quiet',
            '--no-tags',
            '--',
            env.WIZARD_PRIMARY_REPOSITORY_URL || '',
            receipt.wizardRevision,
          ],
          privateEnv,
        )) !== 0 ||
        run(['--git-dir=' + bare, 'rev-parse', 'FETCH_HEAD'], clean, cwd) !==
          receipt.wizardRevision ||
        run(['--git-dir=' + bare, 'cat-file', '-t', receipt.wizardRevision], clean, cwd) !==
          'commit'
      )
        throw Error('The exact Wizard source could not be read from the approved primary.');
      const target = 'refs/source-publication/public';
      const publicTip = async () => {
        run(['--git-dir=' + bare, 'update-ref', '-d', target], clean, cwd);
        if (
          (await transport(
            [
              ...options,
              '-c',
              'protocol.https.allow=always',
              'fetch',
              '--quiet',
              '--no-tags',
              '--',
              receipt.repository,
              receipt.ref + ':' + target,
            ],
            clean,
          )) !== 0
        )
          return null;
        return run(['--git-dir=' + bare, 'rev-parse', target], clean, cwd);
      };
      let verified = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const existing = await publicTip();
        if (existing === receipt.wizardRevision) {
          verified = true;
          break;
        }
        if (existing)
          throw Error('The retained public Wizard ref conflicts; nothing was overwritten.');
        // An empty expected value is an atomic CREATE-ONLY lease. Even an
        // existing ancestor cannot be advanced by this publication attempt.
        await transport(
          [
            ...options,
            '-c',
            'protocol.ssh.allow=always',
            'push',
            '--quiet',
            '--no-follow-tags',
            '--force-with-lease=' + receipt.ref + ':',
            '--',
            env.WIZARD_GITHUB_BACKUP_REMOTE || '',
            receipt.wizardRevision + ':' + receipt.ref,
          ],
          clean,
        );
      }
      if (!verified && (await publicTip()) !== receipt.wizardRevision)
        throw Error('Anonymous public Wizard source verification failed.');
      const output = path.join(cwd, 'test-results/github');
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(
        path.join(output, 'wizard-source.json'),
        JSON.stringify(receipt, null, 2) + '\n',
      );
      return receipt;
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}
