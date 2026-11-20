import {
  accepted,
  row,
  rows,
  text,
  revision,
  positive,
  image,
  hash,
  pages,
  type EvidenceReader,
  type EvidenceRow,
} from './evidence-common';
const components = [
  'gitlab',
  'sync',
  'gitlab-runner',
  'bootstrapper',
  'nginx',
  'wizard',
  'shared',
  'performance',
];
export const systemEvidenceJobs = [
  'check:documentation',
  'prepare:wizard-source',
  'test:candidate-image',
  'test:wizard-browser',
  'test:platform-candidate',
  'build',
  ...components.map((name) => `test:isolated: [${name}]`),
];
export const systemEvidenceStages = [
  'gitlab-upgrade-migrated-data',
  'gitlab-upgrade-registry-ci',
  'gitlab-upgrade-restored-checkpoint',
  'gitlab-upgrade-security-trust',
  'storage-global-live-lease',
  'storage-refuse-nonempty-and-corrupt-restore',
  'storage-detached-backup-normal-operation',
  'cleanup',
];
export const systemStorageProofs = [
  'localLiveVerified',
  'externalSeedRestored',
  'backupDetached',
  'missingBackupGuardVerified',
  'globalLeaseVerified',
  'invalidRestoreGuardVerified',
];
function candidateProof(proof: EvidenceRow, release: EvidenceRow, security: EvidenceRow) {
  const results = rows(proof.results),
    evidence = row(proof.evidence),
    storage = row(evidence.storage),
    upgrade = row(evidence.gitlabUpgrade),
    images = row(proof.images),
    runner = row(security.runner);
  accepted(
    proof.sourceRevision === release.sourceRevision &&
      proof.fullAcceptance === true &&
      /^[a-f0-9]{24}$/.test(text(proof.runId)) &&
      results.length > 0 &&
      results.every((result) => result.status === 'passed') &&
      systemEvidenceStages.every((name) => results.some((result) => result.name === name)),
  );
  accepted(systemStorageProofs.every((key) => storage[key] === true));
  accepted(
    images.candidate === release.imageId &&
      images.wizard === release.wizardImageId &&
      upgrade.fromImage === security.fromImage &&
      upgrade.toImage === security.toImage &&
      ['migrationVerified', 'rollbackVerified', 'registryVerified', 'checkpointVerified'].every(
        (key) => upgrade[key] === true,
      ) &&
      image(upgrade.fromImageId) &&
      image(upgrade.toImageId) &&
      images.gitlab === upgrade.toImageId,
  );
  accepted(
    upgrade.runnerImage === runner.toImage &&
      upgrade.runnerImageId === images.runner &&
      upgrade.runnerVersion === runner.toVersion &&
      upgrade.helperImage === runner.helperImage &&
      upgrade.jobCaBundleSha256 === security.jobCaBundleSha256 &&
      ['securityTrustVerified', 'runnerUpgradeVerified', 'runnerManagerIdentityPreserved'].every(
        (key) => upgrade[key] === true,
      ) &&
      ['runnerImageId', 'fromRunnerImageId', 'helperImageId', 'fromHelperImageId'].every((key) =>
        image(upgrade[key]),
      ) &&
      upgrade.fromRunnerImageId !== upgrade.runnerImageId &&
      upgrade.fromHelperImageId !== upgrade.helperImageId,
  );
}
/** System Review accepts only Stop of a historical owned binding; new delivery is Beta. */
export async function verifySystemEvidence(
  reader: EvidenceReader,
  inputValue: unknown,
  kind: 'beta' | 'review',
) {
  const input = row(inputValue),
    binding = row(input.binding),
    request = row(input.request),
    environment = row(input.environments),
    repository = row(input.repository),
    beta = kind === 'beta';
  accepted(
    beta
      ? binding.version === 2 &&
          binding.sourceLayout === 'system-monorepo-v1' &&
          binding.mrIid === 0 &&
          request.kind === 'beta' &&
          ['deploy', 'stop'].includes(text(request.action))
      : binding.version === 1 &&
          request.kind === 'review' &&
          request.action === 'stop' &&
          positive(binding.mrIid),
  );
  accepted(
    ['projectId', 'namespaceId', 'pipelineId', 'candidateJobId', 'wizardProjectId'].every((key) =>
      positive(binding[key]),
    ) &&
      revision(binding.sourceCommit) &&
      revision(beta ? binding.wizardSourceTree : binding.wizardRevision) &&
      image(binding.helperImage) &&
      image(binding.wizardImageId) &&
      /^[a-f0-9]{48}$/.test(text(binding.operation)) &&
      ['operation', 'projectId', 'mrIid', 'pipelineId', 'sourceCommit'].every(
        (key) => binding[key] === request[key],
      ) &&
      positive(request.jobId),
  );
  const reservation = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !['deployments', 'historicalDeployments'].includes(key),
    ),
  );
  accepted(
    environment.version === 1 &&
      environment.phase === 'ready' &&
      (beta
        ? ['source-primary', 'system-monorepo'].includes(text(environment.managementMode))
        : environment.managementMode === 'source-primary') &&
      environment.operation === binding.operation &&
      image(environment.helperImage) &&
      environment.controller === 'system_bootstrapper_1' &&
      revision(environment.activationCommit) &&
      row(row(environment.settings)[kind]).enabled === true &&
      binding.environmentHash === hash(JSON.stringify(reservation)),
  );
  accepted(
    repository.id === binding.wizardProjectId &&
      repository.path === binding.wizardProjectPath &&
      repository.namespaceId === binding.namespaceId &&
      repository.defaultBranch === binding.wizardDefaultBranch,
  );
  const id = binding.projectId,
    prefix = `projects/${id}/`,
    project = row(await reader.get(`projects/${id}`));
  accepted(
    project.id === id &&
      project.path_with_namespace === binding.projectPath &&
      row(project.namespace).id === binding.namespaceId &&
      project.default_branch === binding.defaultBranch &&
      project.visibility === 'private' &&
      (project.ci_config_path == null || project.ci_config_path === '.gitlab-ci.yml') &&
      project.only_allow_merge_if_pipeline_succeeds === true &&
      project.only_allow_merge_if_all_discussions_are_resolved === true,
  );
  accepted(
    row(
      await reader.get(
        prefix + 'repository/branches/' + encodeURIComponent(text(binding.defaultBranch)),
      ),
    ).protected === true,
  );
  const pipeline = row(await reader.get(prefix + 'pipelines/' + binding.pipelineId)),
    job = row(await reader.get(prefix + 'jobs/' + request.jobId));
  const bound = (value: EvidenceRow) =>
    positive(value.id) &&
    row(value.pipeline).id === binding.pipelineId &&
    row(value.commit).id === binding.sourceCommit &&
    (value.project_id === undefined || value.project_id === id);
  accepted(
    pipeline.id === binding.pipelineId &&
      pipeline.sha === binding.sourceCommit &&
      (beta
        ? ['merge_request_event', 'push', 'web'].includes(text(pipeline.source))
        : pipeline.source === 'merge_request_event') &&
      (pipeline.project_id === undefined || pipeline.project_id === id),
  );
  accepted(
    job.id === request.jobId &&
      bound(job) &&
      job.name === request.action + ':wizard-' + kind &&
      job.status === 'running' &&
      job.allow_failure === true,
  );
  if (!beta) {
    const mr = row(await reader.get(prefix + 'merge_requests/' + binding.mrIid));
    accepted(
      mr.iid === binding.mrIid &&
        mr.source_project_id === id &&
        mr.target_project_id === id &&
        mr.target_branch === binding.defaultBranch,
    );
  }
  // Cleanup must work after artifacts expire or a historical MR advances/closes.
  if (request.action === 'stop') return { ok: true, helperImage: binding.helperImage };
  accepted(beta && ['running', 'success'].includes(text(pipeline.status)));
  const jobs = await pages(
    reader,
    prefix + 'pipelines/' + binding.pipelineId + '/jobs?per_page=100&include_retried=false',
  );
  accepted(new Set(jobs.map((value) => value.id)).size === jobs.length);
  for (const name of systemEvidenceJobs) {
    const selected = jobs.filter((value) => value.name === name);
    accepted(
      selected.length === 1 &&
        bound(selected[0]) &&
        selected[0].status === 'success' &&
        selected[0].allow_failure === false,
    );
  }
  accepted(
    jobs.filter(
      (value) =>
        value.id === request.jobId &&
        value.name === job.name &&
        value.status === 'running' &&
        value.allow_failure === true &&
        bound(value),
    ).length === 1 &&
      jobs
        .filter((value) => value.allow_failure !== true)
        .every((value) => bound(value) && value.status === 'success'),
  );
  const candidate = jobs.find((value) => value.name === 'test:platform-candidate')!;
  accepted(candidate.id === binding.candidateJobId);
  const artifact = prefix + 'jobs/' + candidate.id + '/artifacts/',
    release = row(await reader.get(artifact + 'test-results/successor/release.json')),
    registry = text(project.container_registry_image_prefix);
  accepted(
    /^[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(registry.split('/')[0]) &&
      registry === registry.split('/')[0] + '/' + text(binding.projectPath) &&
      release.format === 'system-successor-release-v1' &&
      release.projectId === id &&
      release.pipelineId === binding.pipelineId &&
      release.candidateJobId === binding.candidateJobId &&
      release.sourceRevision === binding.sourceCommit &&
      revision(release.sourceTree) &&
      release.sourceLayout === 'system-monorepo-v1' &&
      release.wizardSourceTree === binding.wizardSourceTree &&
      release.imageId === binding.helperImage &&
      release.wizardImageId === binding.wizardImageId &&
      release.registryRepository === registry + '/successor' &&
      text(release.registryReference).startsWith(registry + '/successor@') &&
      image(text(release.registryReference).slice((registry + '/successor@').length)) &&
      release.wizardRegistryReference === binding.wizardImageRef &&
      text(release.wizardRegistryReference).startsWith(registry + '/successor-wizard@') &&
      image(
        text(release.wizardRegistryReference).slice((registry + '/successor-wizard@').length),
      ) &&
      release.candidateEvidencePath === 'test-results/successor/candidate-results.json',
  );
  const bytes = await reader.raw(artifact + 'test-results/successor/candidate-results.json');
  accepted(
    Buffer.isBuffer(bytes) &&
      bytes.length <= 8 * 1024 * 1024 &&
      release.candidateEvidenceSha256 === hash(bytes),
  );
  candidateProof(row(JSON.parse(bytes.toString('utf8'))), release, row(input.securityRelease));
  const tree = await pages(
      reader,
      prefix + 'repository/tree?ref=' + binding.sourceCommit + '&per_page=100',
    ),
    wizard = tree.filter((value) => value.path === 'wizard');
  accepted(
    wizard.length === 1 &&
      wizard[0].type === 'tree' &&
      wizard[0].mode === '040000' &&
      wizard[0].id === binding.wizardSourceTree,
  );
  const browser = jobs.find((value) => value.name === 'test:wizard-browser')!;
  for (const stage of ['on-exit', 'after-script']) {
    const cleanup = row(
      await reader.get(
        prefix + `jobs/${browser.id}/artifacts/test-results/wizard-browser/cleanup-${stage}.json`,
      ),
    );
    accepted(
      cleanup.status === 'passed' &&
        cleanup.container === `system-wizard-browser-${id}-${browser.id}` &&
        cleanup.image === `system-wizard-browser:ci-${id}-${browser.id}`,
    );
  }
  return { ok: true, imageRef: text(binding.wizardImageRef), helperImage: binding.helperImage };
}
