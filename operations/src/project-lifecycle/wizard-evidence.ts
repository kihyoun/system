import {
  accepted,
  row,
  rows,
  text,
  revision,
  positive,
  hash,
  decoded,
  same,
  pages,
  nativeJobs,
  sourceFiles,
  managedFiles,
  buildArtifacts,
  pipelineStatuses,
  type EvidenceReader,
  type EvidenceRow,
} from './evidence-common';
export async function verifyWizardProduction(
  reader: EvidenceReader,
  proofValue: unknown,
  bindingValue: unknown,
) {
  const proof = row(proofValue),
    binding = bindingValue == null ? undefined : row(bindingValue);
  accepted(positive(proof.projectId) && positive(proof.pipelineId) && revision(proof.sourceCommit));
  const prefix = `projects/${proof.projectId}/`,
    project = row(await reader.get(prefix.slice(0, -1)));
  accepted(project.visibility === 'private' && project.path_with_namespace === proof.projectPath);
  let repository: EvidenceRow | undefined;
  if (binding) {
    repository = row(binding.repository);
    const source = row(binding.sourcePrimary);
    accepted(
      repository.managementMode === 'source-primary' &&
        repository.ciPath === '.gitlab/primary.yml' &&
        source.version === 1 &&
        repository.id === proof.projectId &&
        repository.path === proof.projectPath &&
        repository.namespaceId === binding.namespaceId &&
        row(project.namespace).id === binding.namespaceId &&
        project.default_branch === repository.defaultBranch &&
        project.ci_config_path === repository.ciPath &&
        project.only_allow_merge_if_pipeline_succeeds === true &&
        project.only_allow_merge_if_all_discussions_are_resolved === true,
    );
    await sourceFiles(reader, prefix, proof.sourceCommit, source.ciFiles, true);
    const reference = text(proof.imageRef),
      imagePrefix = reference.slice(0, reference.lastIndexOf('@'));
    accepted(
      /^[a-z0-9.-]+(?::[0-9]+)?\//.test(imagePrefix) &&
        imagePrefix.slice(imagePrefix.indexOf('/') + 1) === repository.path &&
        /^sha256:[a-f0-9]{64}$/.test(reference.slice(imagePrefix.length + 1)),
    );
  } else accepted(project.ci_config_path === '.system-bootstrapper/ci.yml');
  const pipeline = row(await reader.get(prefix + 'pipelines/' + proof.pipelineId));
  accepted(
    pipeline.id === proof.pipelineId &&
      pipeline.sha === proof.sourceCommit &&
      (binding ? pipelineStatuses.includes(text(pipeline.status)) : pipeline.status === 'success'),
  );
  if (repository) {
    accepted(pipeline.ref === repository.defaultBranch && pipeline.source === 'push');
    accepted(
      row(
        row(
          await reader.get(
            prefix + 'repository/branches/' + encodeURIComponent(text(repository.defaultBranch)),
          ),
        ).commit,
      ).id === pipeline.sha,
    );
  }
  const jobs = await pages(
    reader,
    prefix + `pipelines/${pipeline.id}/jobs?per_page=100&include_retried=false`,
  );
  if (binding) {
    nativeJobs(jobs, pipeline, proof.projectId);
    // Production has no running environment job. A publisher is the only
    // independently identified non-successful required job it may tolerate.
    const publisher = jobs.find((job) => job.name === 'deploy:github');
    accepted(pipeline.status === 'success' || (publisher && publisher.status !== 'success'));
  }
  const reference = text(proof.imageRef),
    registryPrefix = reference.slice(0, reference.lastIndexOf('@'));
  const { build, smoke } = await buildArtifacts(
    reader,
    prefix,
    pipeline,
    jobs,
    registryPrefix,
    true,
    !!binding,
  );
  accepted(
    build.imageRef === proof.imageRef &&
      smoke.imageRef === proof.imageRef &&
      ['configurationBackup', 'cubeSignature'].every((key) => smoke[key] === true),
  );
  return { ok: true };
}
export async function verifyWizardEnvironment(reader: EvidenceReader, inputValue: unknown) {
  const input = row(inputValue),
    repository = row(input.repository),
    request = row(input.request),
    id = repository.id;
  accepted(
    positive(id) &&
      request.projectId === id &&
      positive(request.pipelineId) &&
      positive(request.jobId) &&
      revision(request.sourceCommit) &&
      ['deploy', 'stop'].includes(text(request.action)) &&
      ['review', 'beta'].includes(text(request.kind)),
  );
  const prefix = `projects/${id}/`,
    project = row(await reader.get(`projects/${id}`)),
    primary = repository.managementMode === 'source-primary';
  accepted(
    project.id === id &&
      project.path_with_namespace === repository.path &&
      project.default_branch === repository.defaultBranch,
  );
  if (!primary)
    accepted(
      repository.managementMode == null &&
        project.description ===
          'System Bootstrapper operation ' + text(input.registrationOperation) &&
        project.visibility === 'private' &&
        project.ci_config_path === '.system-bootstrapper/ci.yml',
    );
  const pipeline = row(await reader.get(prefix + 'pipelines/' + request.pipelineId)),
    job = row(await reader.get(prefix + 'jobs/' + request.jobId));
  accepted(
    pipeline.id === request.pipelineId &&
      pipeline.sha === request.sourceCommit &&
      job.id === request.jobId &&
      row(job.pipeline).id === pipeline.id &&
      row(job.commit).id === pipeline.sha &&
      job.name === request.action + ':' + request.kind &&
      job.status === 'running' &&
      (!primary || job.allow_failure === true),
  );
  const environment = row(input.environments);
  if (primary) {
    const source = row(input.sourcePrimary);
    accepted(
      repository.ciPath === '.gitlab/primary.yml' &&
        project.ci_config_path === '.gitlab/primary.yml' &&
        row(project.namespace).id === repository.namespaceId &&
        project.visibility === 'private' &&
        project.only_allow_merge_if_pipeline_succeeds === true &&
        project.only_allow_merge_if_all_discussions_are_resolved === true &&
        source.version === 1 &&
        environment.managementMode === 'source-primary' &&
        environment.activationCommit === source.adoptionCommit &&
        same(source.ciFiles, environment.ciFiles),
    );
    await sourceFiles(reader, prefix, pipeline.sha, source.ciFiles);
  } else {
    const recipe = row(input.recipe);
    await managedFiles(
      reader,
      prefix,
      pipeline.sha,
      [...rows(recipe.files), { path: '.system-bootstrapper/ci.yml', content: recipe.ci }],
      environment.activationCommit,
    );
    const files = rows(input.legacyFiles),
      marker = row(input.legacyMarker);
    accepted(
      files.length > 0 &&
        files.every((file) => text(file.path).startsWith('.system-bootstrapper/build-v1/')) &&
        marker.path === '.system-bootstrapper/wizard-build.json',
    );
    await managedFiles(
      reader,
      prefix,
      pipeline.sha,
      [...files, marker],
      input.buildActivationCommit,
    );
    const file = row(
        await reader.get(
          prefix +
            'repository/files/' +
            encodeURIComponent('.system-bootstrapper/wizard-environments.json') +
            '?ref=' +
            pipeline.sha,
        ),
      ),
      data = row(JSON.parse(decoded(file.content).toString('utf8')));
    const expected = {
      version: 1,
      operation: environment.operation,
      recipeHash: environment.recipeHash,
      settingsHash: environment.settingsHash,
      helperImage: environment.helperImage,
      controller: environment.controller,
    };
    accepted(
      file.last_commit_id === environment.activationCommit &&
        same(
          Object.fromEntries(Object.entries(data).filter(([key]) => key !== 'parentCommit')),
          expected,
        ) &&
        revision(data.parentCommit),
    );
    accepted(
      same(
        row(await reader.get(prefix + 'repository/commits/' + environment.activationCommit))
          .parent_ids,
        [data.parentCommit],
      ),
    );
  }
  if (request.kind === 'review') {
    accepted(pipeline.source === 'merge_request_event' && positive(request.mrIid));
    const mr = row(await reader.get(prefix + 'merge_requests/' + request.mrIid));
    accepted(
      mr.iid === request.mrIid && mr.source_project_id === id && mr.target_project_id === id,
    );
    if (request.action === 'deploy') {
      accepted(mr.state === 'opened' && (mr.sha ?? row(mr.diff_refs).head_sha) === pipeline.sha);
      const related = await pages(
        reader,
        prefix + `merge_requests/${request.mrIid}/pipelines?per_page=100`,
      );
      accepted(
        related.some((value) => value.id === pipeline.id && value.sha === pipeline.sha) &&
          related.every((value) => positive(value.id) && Number(value.id) <= Number(pipeline.id)),
      );
    }
  } else {
    accepted(
      pipeline.ref === project.default_branch &&
        ['push', 'api', 'web'].includes(text(pipeline.source)),
    );
    if (request.action === 'deploy')
      accepted(
        row(
          row(
            await reader.get(
              prefix + 'repository/branches/' + encodeURIComponent(text(project.default_branch)),
            ),
          ).commit,
        ).id === pipeline.sha,
      );
  }
  if (request.action === 'stop') return { ok: true };
  const jobs = await pages(
    reader,
    prefix + `pipelines/${pipeline.id}/jobs?per_page=100&include_retried=false`,
  );
  if (primary) nativeJobs(jobs, pipeline, id);
  const { required, build } = await buildArtifacts(
    reader,
    prefix,
    pipeline,
    jobs,
    text(input.registryPrefix),
    primary,
  );
  if (primary) {
    for (const [index, requiredJob] of required.entries()) {
      const expected =
        index === 0
          ? `wizard-build-${id}-${requiredJob.id}`
          : `wizard-check-${id}-${requiredJob.id}-builder`;
      const cleanup = row(
        await reader.get(prefix + `jobs/${requiredJob.id}/artifacts/cleanup.json`),
      );
      accepted(cleanup.status === 'passed' && cleanup.builder === expected);
    }
    const browser = row(
      await reader.get(prefix + `jobs/${required[1].id}/artifacts/browser-evidence/browser.json`),
    );
    accepted(
      [
        'http',
        'renderedUI',
        'projects',
        'spa',
        'configurationBackup',
        'cubeSignature',
        'overviewNavigation',
      ].every((key) => browser[key] === true),
    );
  }
  return { ok: true, imageRef: text(build.imageRef) };
}
