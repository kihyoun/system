import { acceptedCliArtifact } from './github-cli-artifact';
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
    requireValue(
      released.sourceLayout === 'system-monorepo-v1',
      'Publish historical releases with their own accepted source; this publisher requires the monorepo CLI artifact.',
    );
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
        '`; Wizard tree: `' +
        released.wizardSourceTree +
        '`.\nWizard sources are included in this System commit and its source archives.\n' +
        'See [Quickstart](https://github.com/' +
        ci.repository +
        '/blob/' +
        ci.tag +
        '/docs/QUICKSTART.md) and the versioned metadata asset.\n',
    );
    const template = bounded(path.join(root, 'tools/quickstart/quickstart.sh')).toString();
    const marker =
      'const ACCEPTED_RELEASE_TAG = null; // Replaced only in the accepted public release asset.';
    requireValue(
      template.split(marker).length === 2,
      'Quickstart release binding marker required.',
    );
    const repositoryMarker =
      "const REPOSITORY = 'kihyoun/system'; // Replaced for the accepted public mirror.";
    requireValue(
      template.split(repositoryMarker).length === 2,
      'Quickstart mirror binding marker required.',
    );
    const quickstart = Buffer.from(
      template
        .replace(
          marker,
          "const ACCEPTED_RELEASE_TAG = '" + ci.tag + "'; // Accepted public release.",
        )
        .replace(
          repositoryMarker,
          "const REPOSITORY = '" + ci.repository + "'; // Accepted public mirror.",
        ),
    );
    const metadata = publicMetadata(ci, released, publication, undefined, notes, quickstart);
    const cliAssets: Record<string, Buffer> = {};
    if (released.sourceLayout === 'system-monorepo-v1') {
      const job = jobs.find((row) => row.name === 'test:npm-package')!;
      const receiptPath = 'test-results/npm-package/receipt.json';
      const receiptBytes = bounded(path.join(root, receiptPath));
      const filename = `systembootstrapper-cli-${ci.version}.tgz`,
        artifactPath = 'test-results/npm-package/' + filename;
      const bytes = bounded(path.join(root, artifactPath));
      metadata.quickstart.cli = acceptedCliArtifact(JSON.parse(receiptBytes.toString()), bytes, {
        version: ci.version,
        sourceRevision: released.sourceRevision,
        sourceTree: released.sourceTree,
        pipelineId: ci.pipelineId,
        packageJobId: job.id,
      });
      for (const [file, local] of [
        [receiptPath, receiptBytes],
        [artifactPath, bytes],
      ] as const) {
        const remote = await gitlab(
          '/projects/' + ci.projectId + '/jobs/' + job.id + '/artifacts/' + file,
          { raw: true },
        );
        requireValue(
          Buffer.isBuffer(remote) && remote.equals(local),
          'CLI input differs from successful same-attempt package artifact.',
        );
      }
      cliAssets[filename] = bytes;
    }
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
        'tools/quickstart/quickstart.sh',
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
      ...cliAssets,
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
    const result = await present(ci, assets, github, anonymous);
    const output = path.join(root, 'test-results/public-release');
    fs.mkdirSync(output, { recursive: true });
    for (const [file, value] of Object.entries(assets))
      fs.writeFileSync(path.join(output, file), value);
    requireValue(typeof result.html_url === 'string', 'Published release URL required.');
    return { tag: ci.tag, url: result.html_url };
  }
}
