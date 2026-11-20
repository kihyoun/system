import { Inject, Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProcessRunner } from '../runtime/process';
import type { Environment } from './types';
import {
  environmentId,
  hash,
  integrity,
  readNpmReceipt,
  record,
  requireNpm,
  validateNpmPublication,
  validVersion,
  type NpmReceipt,
} from './npm-identity';

export const NPM_PUBLICATION_PORTS = Symbol('NPM_PUBLICATION_PORTS');
export interface NpmEvidence {
  projectId: number;
  pipelineId: number;
  sourceRevision: string;
  jobs: unknown[];
  artifact(jobId: number, filename: string): Promise<Buffer>;
}
/** The GitLab adapter supplies existing acceptance policy and authenticated transport. */
export interface NpmPublicationPorts {
  processes: ProcessRunner;
  request: typeof fetch;
  evidence(env: Environment, root: string, layout: unknown): Promise<NpmEvidence>;
  token(env: Environment): string;
}
function readArtifact(filename: string): Buffer {
  const stat = fs.lstatSync(filename);
  requireNpm(
    stat.isFile() && stat.size > 0 && stat.size <= 128 * 1024 ** 2,
    'invalid-npm-artifact',
  );
  return fs.readFileSync(filename);
}
function commandEnvironment(env: Environment, home: string): Environment {
  // Do not pass arbitrary npm_config_*, NODE_OPTIONS or publisher credentials to npm.
  const result: Environment = { PATH: env.PATH ?? process.env.PATH, HOME: home, TMPDIR: home };
  for (const name of ['SystemRoot', 'WINDIR']) if (env[name]) result[name] = env[name];
  return result;
}
@Injectable()
export class NpmPublicationService {
  constructor(@Inject(NPM_PUBLICATION_PORTS) private readonly ports: NpmPublicationPorts) {}

  prepare(root: string, env: Environment): NpmReceipt {
    const run = (binary: string, args: string[], cwd = root) =>
      this.ports.processes
        .run(binary, args, { cwd, timeout: 120000, maxBuffer: 4 * 1024 ** 2 })
        .stdout.trim();
    const revision = run('git', ['rev-parse', 'HEAD']);
    requireNpm(
      revision === env.CI_COMMIT_SHA && /^[a-f0-9]{40}$/.test(revision),
      'exact-native-package-source-required',
    );
    const pipelineId = environmentId(env.CI_PIPELINE_ID);
    const packageJobId = environmentId(env.CI_JOB_ID);
    run('git', ['diff', '--quiet', 'HEAD', '--', '.']);
    const directory = path.join(root, 'operations');
    const metadata = record(
      JSON.parse(readArtifact(path.join(directory, 'package.json')).toString()),
    );
    const version = readArtifact(path.join(root, 'VERSION')).toString().trim();
    requireNpm(
      validVersion(version) &&
        metadata.name === '@systembootstrapper/cli' &&
        metadata.version === version,
      'package-release-identity-mismatch',
    );
    const source = {
      format: 'system-cli-source-v1',
      sourceRevision: revision,
      sourceTree: run('git', ['rev-parse', 'HEAD^{tree}']),
      version,
      pipelineId,
      packageJobId,
    };
    fs.writeFileSync(path.join(directory, 'assets/source.json'), JSON.stringify(source) + '\n');
    const output = path.join(root, 'test-results/npm-package');
    fs.mkdirSync(output, { recursive: true });
    const packed: unknown = JSON.parse(
      run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', output], directory),
    );
    requireNpm(Array.isArray(packed) && packed.length === 1, 'invalid-packed-npm-result');
    const filename = record(packed[0]).filename;
    requireNpm(filename === `systembootstrapper-cli-${version}.tgz`, 'invalid-npm-filename');
    const bytes = readArtifact(path.join(output, filename));
    const receipt = readNpmReceipt({
      ...source,
      name: metadata.name,
      filename,
      sha256: hash(bytes),
      integrity: integrity(bytes),
    });
    fs.writeFileSync(path.join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    return receipt;
  }

  private async registryState(receipt: NpmReceipt): Promise<boolean> {
    const endpoint =
      'https://registry.npmjs.org/' + encodeURIComponent(receipt.name) + '/' + receipt.version;
    const response = await this.ports.request(endpoint, {
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404) return false;
    requireNpm(response.ok, 'npm-registry-unavailable');
    const value = record(await response.json());
    requireNpm(
      value.name === receipt.name &&
        value.version === receipt.version &&
        record(value.dist).integrity === receipt.integrity,
      'existing-public-npm-version-differs',
    );
    return true;
  }

  async publish(env: Environment, root: string): Promise<NpmReceipt> {
    const directory = path.join(root, 'test-results/npm-package');
    const receiptPath = 'test-results/npm-package/receipt.json';
    const receiptBytes = readArtifact(path.join(root, receiptPath));
    const receipt = readNpmReceipt(JSON.parse(receiptBytes.toString()));
    const packagePath = 'test-results/npm-package/' + receipt.filename;
    const bytes = readArtifact(path.join(directory, receipt.filename));
    const releasePath = 'test-results/public-release/system-release-v' + receipt.version + '.json';
    const releaseBytes = readArtifact(path.join(root, releasePath));
    const metadata = record(JSON.parse(releaseBytes.toString()));
    validateNpmPublication(receipt, metadata, env, bytes);
    const evidence = await this.ports.evidence(env, root, record(metadata.source).sourceLayout);
    requireNpm(
      evidence.sourceRevision === receipt.sourceRevision &&
        evidence.pipelineId === receipt.pipelineId &&
        Number.isSafeInteger(evidence.projectId) &&
        evidence.projectId > 0,
      'npm-evidence-context-mismatch',
    );
    const checks: [string, [string, Buffer][]][] = [
      [
        'test:npm-package',
        [
          [receiptPath, receiptBytes],
          [packagePath, bytes],
        ],
      ],
      ['deploy:github-release', [[releasePath, releaseBytes]]],
    ];
    for (const [name, artifacts] of checks) {
      const rows = evidence.jobs.map(record).filter((row) => row.name === name);
      requireNpm(rows.length === 1, 'same-attempt-npm-job-required');
      const job = rows[0];
      requireNpm(
        job.status === 'success' &&
          job.allow_failure === false &&
          record(job.commit).id === receipt.sourceRevision &&
          record(job.pipeline).id === receipt.pipelineId &&
          Number.isSafeInteger(job.id) &&
          Number(job.id) > 0 &&
          (name !== 'test:npm-package' || job.id === receipt.packageJobId),
        'successful-same-attempt-npm-job-required',
      );
      for (const [filename, local] of artifacts) {
        const remote = await evidence.artifact(Number(job.id), filename);
        requireNpm(
          Buffer.isBuffer(remote) && hash(remote) === hash(local),
          'npm-artifact-ownership-mismatch',
        );
      }
    }
    if (await this.registryState(receipt)) return receipt;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'system-npm-'));
    fs.chmodSync(temporary, 0o700);
    try {
      const credential = this.ports.token(env);
      requireNpm(
        typeof credential === 'string' && /^[A-Za-z0-9_-]+$/.test(credential),
        'invalid-npm-credential',
      );
      const npmrc = path.join(temporary, 'npmrc');
      fs.writeFileSync(
        npmrc,
        'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=' +
          credential +
          '\n',
        { mode: 0o600 },
      );
      // Publish the frozen bytes already compared with native artifacts, not a mutable workspace path.
      const tarball = path.join(temporary, receipt.filename);
      fs.writeFileSync(tarball, bytes, { mode: 0o600 });
      try {
        this.ports.processes.run(
          'npm',
          [
            'publish',
            tarball,
            '--access',
            'public',
            '--ignore-scripts',
            '--provenance=false',
            '--registry=https://registry.npmjs.org/',
            '--userconfig=' + npmrc,
            '--globalconfig=' + path.join(temporary, 'global-npmrc'),
          ],
          {
            cwd: temporary,
            env: commandEnvironment(env, temporary),
            timeout: 120000,
            maxBuffer: 1024 ** 2,
          },
        );
      } catch {
        // A lost command response may follow a successful immutable publication.
        requireNpm(await this.registryState(receipt), 'npm-publication-failed');
        return receipt;
      }
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    requireNpm(await this.registryState(receipt), 'public-npm-package-verification-failed');
    return receipt;
  }
}
