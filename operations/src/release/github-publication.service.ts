import { publicUpgradeAssets, type PublicUpgradePolicy } from './public-upgrade-assets';
import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { verifyCheckout } from './source-identity';
import { githubContext, githubGates as gates } from './github-acceptance';
import { githubPublicMetadata as publicMetadata } from './github-metadata';
import { presentGithubRelease as present } from './github-presentation';
import {
  boundedReleaseInput as bounded,
  publicationHash as hash,
  publicationToken as token,
  publicationApi as api,
  publicationRecord as record,
  requirePublication as requireValue,
  type PublicationApi,
} from './github-transport';
import type { Environment, Execute } from './types';
import type { createDockerHubPublisher } from './dockerhub-publication';
export const GITHUB_PUBLICATION_PORTS = Symbol('GITHUB_PUBLICATION_PORTS');
export interface GithubPublicationPorts {
  request: typeof fetch;
  execute: Execute;
  images: Pick<
    ReturnType<typeof createDockerHubPublisher>,
    'context' | 'readEvidence' | 'manifest'
  >;
  upgrade: PublicUpgradePolicy;
}
@Injectable()
export class GithubPublicationService {
  constructor(@Inject(GITHUB_PUBLICATION_PORTS) private readonly ports: GithubPublicationPorts) {}
  async publish(env: Environment, root: string): Promise<{ tag: string; url: string }> {
    const { request, execute: command } = this.ports;
    const ci = githubContext(env, root, this.ports.images.context),
      { released, proof } = this.ports.images.readEvidence(root, ci, env);
    const origin = new URL(env.CI_API_V4_URL ?? '');
    requireValue(
      origin.protocol === 'https:' &&
        !origin.username &&
        !origin.password &&
        !origin.search &&
        !origin.hash,
      'Trusted HTTPS GitLab API required.',
    );
    const gitlab = api(
      origin.href.replace(/\/$/, ''),
      token(env, 'SYSTEM_RELEASE_GITLAB_TOKEN'),
      'PRIVATE-TOKEN',
      request,
    );
    const jobs = await gates(ci, env, root, gitlab, released.sourceLayout);
    const publication = record(
      JSON.parse(bounded(path.join(root, 'test-results/dockerhub/release.json')).toString()),
    );
    requireValue(
      publication.publicationJobId === jobs.find((row) => row.name === 'deploy:dockerhub')!.id,
      'Image publisher job mismatch.',
    );
    requireValue(
      released.candidateJobId === jobs.find((row) => row.name === 'test:platform-candidate')!.id,
      'Accepted candidate job mismatch.',
    );
    let source: Record<string, unknown> | undefined;
    if (released.sourceLayout !== 'system-monorepo-v1') {
      requireValue(
        env.WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED === 'true',
        'Historical Wizard source publication must be enabled.',
      );
      source = record(
        JSON.parse(bounded(path.join(root, 'test-results/github/wizard-source.json')).toString()),
      );
      requireValue(
        source.publicationJobId === jobs.find((row) => row.name === 'deploy:github')!.id,
        'Source publisher job mismatch.',
      );
    }
    const changelog = bounded(path.join(root, 'CHANGELOG.md')).toString();
    const escapedVersion = ci.version.replaceAll('.', '\\.');
    const match = new RegExp(
      '^## ' + escapedVersion + '\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))',
      'm',
    ).exec(changelog);
    requireValue(match, 'Reviewed version changelog entry required.');
    const entries = match[1]
      .trim()
      .replace(
        /\]\((docs\/[^)]+)\)/g,
        '](' + 'https://github.com/' + ci.repository + '/blob/' + ci.tag + '/$1)',
      );
    const notes = Buffer.from(
      '# System Bootstrapper ' +
        ci.version +
        '\n' +
        entries +
        '\n\n' +
        'Exact source: `' +
        released.sourceRevision +
        '`; Wizard ' +
        (released.sourceLayout === 'system-monorepo-v1'
          ? 'tree: `' + released.wizardSourceTree
          : 'commit: `' + released.wizardRevision) +
        '`.\n' +
        (released.sourceLayout === 'system-monorepo-v1'
          ? 'Wizard sources are included in this System commit and its source archives.\n'
          : 'Clone with Git, check out this tag and run `git submodule update --init --recursive`. GitHub source archives omit submodule contents.\n') +
        'See [Quickstart](https://github.com/' +
        ci.repository +
        '/blob/' +
        ci.tag +
        '/docs/QUICKSTART.md) and the versioned metadata asset.\n',
    );
    const template = bounded(path.join(root, 'bootstrapper/quickstart.sh')).toString();
    const marker =
      'ACCEPTED_RELEASE_TAG = None  # Replaced only in the accepted public release asset.';
    requireValue(
      template.split(marker).length === 2,
      'Quickstart release binding marker required.',
    );
    const repositoryMarker =
      "REPOSITORY = 'kihyoun/system'  # Replaced for the accepted public mirror.";
    requireValue(
      template.split(repositoryMarker).length === 2,
      'Quickstart mirror binding marker required.',
    );
    const quickstart = Buffer.from(
      template
        .replace(marker, "ACCEPTED_RELEASE_TAG = '" + ci.tag + "'  # Accepted public release.")
        .replace(
          repositoryMarker,
          "REPOSITORY = '" + ci.repository + "'  # Accepted public mirror.",
        ),
    );
    ci.hostInstallerSha256 = hash(bounded(path.join(root, 'bootstrapper/install.sh')));
    const metadata = publicMetadata(ci, released, publication, source, notes, quickstart);
    const upgradeAssets = publicUpgradeAssets(
      metadata,
      released,
      proof,
      JSON.parse(bounded(path.join(root, 'bootstrapper/upgrade-paths.json')).toString()),
      jobs,
      this.ports.upgrade,
    );
    ci.sourceTree = released.sourceTree;
    verifyCheckout(released, root, command);
    if (source) {
      const mapping = command(
        'git',
        ['config', '--blob', 'HEAD:.gitmodules', '--get', 'submodule.wizard.url'],
        { cwd: root },
      );
      requireValue(
        mapping === source.repository,
        'Accepted public Wizard repository mapping mismatch.',
      );
    }
    command(
      'git',
      [
        'diff',
        '--quiet',
        '--exit-code',
        'HEAD',
        '--',
        'VERSION',
        'CHANGELOG.md',
        'bootstrapper/quickstart.sh',
        'bootstrapper/upgrade-paths.json',
        'gitlab/public-upgrade-release.js',
      ],
      { cwd: root },
    );
    for (const role of ['controller', 'wizard'] as const) {
      const [repository, digest] = metadata.images[role].reference
        .replace(/^docker\.io\//, '')
        .split('@');
      const found = await this.ports.images.manifest(repository, digest, request);
      requireValue(
        found?.digest === digest && found.configDigest === metadata.images[role].configDigest,
        'Accepted public images must remain anonymously available.',
      );
    }
    const bytes = Buffer.from(JSON.stringify(metadata, null, 2) + '\n'),
      name = 'system-release-' + ci.tag + '.json';
    const assets = {
      [name]: bytes,
      [name + '.sha256']: Buffer.from(hash(bytes) + '  ' + name + '\n'),
      'quickstart.sh': quickstart,
      'release-notes.md': notes,
      ...upgradeAssets,
    };
    const credential = token(env, 'GITHUB_RELEASE_TOKEN');
    const base = api('https://api.github.com', 'Bearer ' + credential, 'Authorization', request);
    const github: PublicationApi = (route, options) =>
      route.startsWith('/uploads/')
        ? api(
            'https://uploads.github.com',
            'Bearer ' + credential,
            'Authorization',
            request,
          )(route.slice(8), options)
        : base(route, options);
    const anonymous = api('https://api.github.com', '', 'X-System-Public-Verification', request);
    if (source) {
      requireValue(typeof source.repository === 'string', 'Historical Wizard repository required.');
      const wizardRepository = source.repository.slice('https://github.com/'.length, -4);
      const wizardSource = record(
        await anonymous('/repos/' + wizardRepository + '/git/commits/' + released.wizardRevision),
      );
      requireValue(
        wizardSource?.sha === released.wizardRevision,
        'Exact pinned Wizard source must remain public.',
      );
    }
    const result = await present(ci, assets, github, anonymous);
    const output = path.join(root, 'test-results/public-release');
    fs.mkdirSync(output, { recursive: true });
    for (const [file, value] of Object.entries(assets))
      fs.writeFileSync(path.join(output, file), value);
    requireValue(typeof result.html_url === 'string', 'Published release URL required.');
    return { tag: ci.tag, url: result.html_url };
  }
}
