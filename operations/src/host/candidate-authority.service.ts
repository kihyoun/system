import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { HostInstallService, requireValue as ensure } from './install';
import {
  HostReleaseAuthorityService,
  hostComponents,
  hostRequiredJobs,
} from './release-authority.service';
import { record, imageId, positive } from '../release/source-identity';
import { canonicalDigest, recoveryReference } from './recovery-manifest';
type Row = Record<string, unknown>;
export interface CandidateGitLabApi {
  get(endpoint: string): Promise<unknown>;
  pages(endpoint: string): Promise<unknown[]>;
  raw(endpoint: string): Promise<Buffer>;
}
const releasePath = 'test-results/successor/release.json',
  evidencePath = 'test-results/successor/candidate-results.json';
const digest = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
const component = (name: unknown) => {
  ensure(typeof name === 'string', 'invalid-successor-job-name');
  const match = /^test:isolated:\s*\[([a-z-]+)\]$/.exec(name);
  return match ? 'component:' + match[1] : 'job:' + name;
};
/** Native CI remains the authority; retained historical receipts never imply a new successful job. */
export class CandidateAuthorityService {
  constructor(
    readonly host: HostInstallService,
    readonly releases: HostReleaseAuthorityService,
  ) {}
  async pipeline(
    api: CandidateGitLabApi,
    release: Row,
    releaseBytes: Buffer,
    evidenceBytes: Buffer,
    current = true,
  ): Promise<Row> {
    ensure(
      ['projectId', 'pipelineId', 'candidateJobId'].every((key) => positive(release[key])),
      'invalid-successor-CI-identity',
    );
    ensure(
      isDeepStrictEqual(JSON.parse(releaseBytes.toString()), release),
      'successor-release-input-mismatch',
    );
    const prefix = '/projects/' + release.projectId,
      project = record(await api.get(prefix)),
      branch = project.default_branch;
    ensure(typeof branch === 'string' && branch, 'GitLab-default-branch-required');
    ensure(
      project.only_allow_merge_if_pipeline_succeeds === true,
      'GitLab-required-merge-gate-disabled',
    );
    ensure(
      release.registryRepository ===
        String(project.container_registry_image_prefix ?? '') + '/successor',
      'successor-registry-project-mismatch',
    );
    const pipeline = record(await api.get(prefix + '/pipelines/' + release.pipelineId));
    ensure(
      pipeline.sha === release.sourceRevision &&
        pipeline.ref === branch &&
        ['push', 'web', 'schedule'].includes(String(pipeline.source)),
      'successor-default-branch-pipeline-required',
    );
    const branchState = record(
      await api.get(prefix + '/repository/branches/' + encodeURIComponent(branch)),
    );
    ensure(branchState.protected === true, 'GitLab-default-branch-is-not-protected');
    if (current)
      ensure(
        record(branchState.commit).id === release.sourceRevision,
        'successor-default-branch-advanced',
      );
    const jobs = (
        await api.pages(prefix + '/pipelines/' + release.pipelineId + '/jobs?include_retried=false')
      ).map(record),
      selected = new Map<string, Row>();
    for (const row of jobs) {
      const key = component(row.name);
      ensure(!selected.has(key), 'successor-duplicate-job-identity');
      selected.set(key, row);
    }
    const required: string[] = [
      ...hostRequiredJobs.map((name) => 'job:' + name),
      ...hostComponents.map((name) => 'component:' + name),
    ];
    if (current || selected.has('job:test:codeql')) required.push('job:test:codeql');
    for (const key of required) {
      const row = selected.get(key) ?? {};
      ensure(
        row.status === 'success' && row.allow_failure === false,
        'successor-required-job-not-successful',
      );
      ensure(
        (record(row.pipeline ?? {}).id ?? release.pipelineId) === release.pipelineId,
        'successor-job-pipeline-mismatch',
      );
    }
    ensure(
      selected.get('job:test:platform-candidate')!.id === release.candidateJobId,
      'successor-candidate-job-mismatch',
    );
    const failed = jobs.filter((row) => ['failed', 'canceled'].includes(String(row.status)));
    ensure(
      failed.every((row) => row.name === 'deploy:github' && row.status === 'failed'),
      'successor-internal-pipeline-failed',
    );
    ensure(
      pipeline.status === 'success' ||
        (pipeline.status === 'failed' && failed.length === 1 && failed[0].name === 'deploy:github'),
      'successor-pipeline-not-complete',
    );
    const artifact = prefix + '/jobs/' + release.candidateJobId + '/artifacts/';
    const [remoteRelease, remoteEvidence] = await Promise.all([
      api.raw(artifact + releasePath),
      api.raw(artifact + evidencePath),
    ]);
    ensure(
      digest(remoteRelease) === digest(releaseBytes) &&
        digest(remoteEvidence) === digest(evidenceBytes),
      'successor-inputs-do-not-match-CI-artifacts',
    );
    return {
      projectId: release.projectId,
      pipelineId: release.pipelineId,
      candidateJobId: release.candidateJobId,
      sourceRevision: release.sourceRevision,
      requiredJobsPassed: required.length,
      GitHubMirrorFailed: failed.length > 0,
    };
  }
  wizard(release: Row, evidence: Row): void {
    const reference = release.wizardRegistryReference;
    ensure(
      imageId(release.wizardImageId) &&
        record(evidence.images).wizard === release.wizardImageId &&
        typeof reference === 'string' &&
        recoveryReference(reference) &&
        reference.includes('@') &&
        canonicalDigest(reference) === reference &&
        reference.split('@')[0] === release.registryRepository + '-wizard',
      'successor-Wizard-release-evidence-mismatch',
    );
  }
  async publicPair(
    api: CandidateGitLabApi,
    release: Row,
    evidence: Row,
    controller: string,
    wizard: string,
  ): Promise<Row> {
    this.wizard(release, evidence);
    const prefix = '/projects/' + release.projectId,
      pipeline = record(await api.get(prefix + '/pipelines/' + release.pipelineId));
    ensure(pipeline.source === 'push', 'paired-release-requires-native-default-branch-push');
    const jobs = (
      await api.pages(prefix + '/pipelines/' + release.pipelineId + '/jobs?include_retried=false')
    ).map(record);
    const job = (name: string, message: string) => {
      const matches = jobs.filter((row) => row.name === name);
      ensure(matches.length === 1, message);
      const value = matches[0];
      ensure(
        value.status === 'success' &&
          value.allow_failure === false &&
          record(value.pipeline).id === release.pipelineId &&
          record(value.commit).id === release.sourceRevision &&
          positive(value.id),
        message,
      );
      return value;
    };
    job('test:wizard-browser', 'paired-Wizard-browser-job-not-successful');
    const publication = job('deploy:dockerhub', 'paired-publication-job-not-successful');
    const bytes = await api.raw(
        prefix + '/jobs/' + publication.id + '/artifacts/test-results/dockerhub/release.json',
      ),
      value = record(JSON.parse(bytes.toString()));
    const monorepo = release.sourceLayout === 'system-monorepo-v1',
      keys = monorepo
        ? [
            'projectId',
            'pipelineId',
            'sourceRevision',
            'sourceTree',
            'sourceLayout',
            'wizardSourceTree',
          ]
        : ['projectId', 'pipelineId', 'sourceRevision', 'sourceTree', 'wizardRevision'];
    const upstream = Object.fromEntries(
      [
        'projectId',
        'pipelineId',
        'candidateJobId',
        'registryReference',
        'candidateEvidenceSha256',
      ].map((key) => [key, release[key]]),
    );
    ensure(
      value.format === 'system-public-release-v1' &&
        keys.every((key) => value[key] === release[key]) &&
        value.publicationJobId === publication.id &&
        value.versionTag === null &&
        value.platform === 'linux/amd64' &&
        isDeepStrictEqual(value.upstreamRelease, upstream),
      'paired-publication-source-mismatch',
    );
    for (const [role, selected, image, source, internal] of [
      [
        'controller',
        controller,
        release.imageId,
        release.sourceRevision,
        release.registryReference,
      ],
      [
        'wizard',
        wizard,
        release.wizardImageId,
        monorepo ? release.sourceRevision : release.wizardRevision,
        release.wizardRegistryReference,
      ],
    ]) {
      const row = record(value[String(role)]);
      ensure(
        typeof row.reference === 'string' &&
          row.reference.replace(/^docker\.io\//, '') ===
            String(selected).replace(/^docker\.io\//, '') &&
          row.imageId === image &&
          row.sourceRevision === source &&
          imageId(row.configDigest) &&
          String(selected).split('@').at(-1) === String(internal).split('@').at(-1),
        'paired-publication-image-mismatch',
      );
    }
    const mirror = job('deploy:github', 'paired-source-publication-job-not-successful');
    if (monorepo) {
      ensure(value.wizardRevision == null, 'paired-publication-source-mismatch');
      return {
        jobId: publication.id,
        artifactSha256: digest(bytes),
        sourceJobId: mirror.id,
        sourceLayout: release.sourceLayout,
        sourceRevision: release.sourceRevision,
        sourceTree: release.sourceTree,
        wizardSourceTree: release.wizardSourceTree,
      };
    }
    const sourceBytes = await api.raw(
        prefix + '/jobs/' + mirror.id + '/artifacts/test-results/github/wizard-source.json',
      ),
      source = record(JSON.parse(sourceBytes.toString()));
    const mapping = await api.raw(
      prefix + '/repository/files/.gitmodules/raw?ref=' + release.sourceRevision,
    );
    const read = (key: string) =>
      this.host.runner
        .run('git', ['config', '--no-includes', '--file', '-', '--get-all', key], {
          input: mapping,
          timeout: 10000,
          maxBuffer: 8 * 1024 ** 2,
          env: { PATH: this.host.environment.PATH, GIT_CONFIG_NOSYSTEM: '1', HOME: '/nonexistent' },
        })
        .stdout.trim();
    ensure(read('submodule.wizard.path') === 'wizard', 'paired-source-submodule-mapping-required');
    const repository = read('submodule.wizard.url');
    ensure(
      /^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.git$/.test(repository) &&
        isDeepStrictEqual(source, {
          format: 'system-wizard-source-publication-v1',
          projectId: release.projectId,
          pipelineId: release.pipelineId,
          publicationJobId: mirror.id,
          systemRevision: release.sourceRevision,
          wizardRevision: release.wizardRevision,
          repository,
          ref: 'refs/heads/system-release/' + release.wizardRevision,
        }),
      'paired-source-publication-mismatch',
    );
    return {
      jobId: publication.id,
      artifactSha256: digest(bytes),
      sourceJobId: mirror.id,
      sourceArtifactSha256: digest(sourceBytes),
    };
  }
  async completed(
    api: CandidateGitLabApi,
    value: Row,
    security: unknown,
  ): Promise<{ release: Row; evidence: Row }> {
    ensure(
      value.format === 'system-controller-promotion-v1' &&
        value.phase === 'controller-promoted-old-GitLab-preserved' &&
        value.GitLabMigrationStarted === false &&
        typeof value.coldMaintenance === 'boolean' &&
        [
          'oldGitLabImagePreserved',
          'configurationChangedOnlyControllerImage',
          'managerIdentitiesPreserved',
        ].every((key) => value[key] === true),
      'completed-staged-controller-promotion-required',
    );
    const retained = record(value.release);
    ensure(
      positive(retained.projectId) && positive(retained.candidateJobId),
      'invalid-staged-controller-release',
    );
    const prefix =
      '/projects/' + retained.projectId + '/jobs/' + retained.candidateJobId + '/artifacts/';
    const [releaseBytes, evidenceBytes] = await Promise.all([
      api.raw(prefix + releasePath),
      api.raw(prefix + evidencePath),
    ]);
    const { release, evidence } = this.releases.inputs(releaseBytes, evidenceBytes, security);
    ensure(isDeepStrictEqual(release, retained), 'staged-controller-release-does-not-match-CI');
    ensure(
      isDeepStrictEqual(
        await this.pipeline(api, release, releaseBytes, evidenceBytes, false),
        value.pipeline,
      ),
      'staged-controller-pipeline-receipt-mismatch',
    );
    return { release, evidence };
  }
}
