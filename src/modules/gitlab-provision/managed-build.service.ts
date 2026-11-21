import { Injectable } from '@nestjs/common';
import type { GitlabActivationSession } from './source-primary-activation.service';
import {
  type RecipeRow as Row,
  recipeRow as row,
  recipeText as text,
  recipeFiles as files,
  ensureRecipe as ensure,
  decodedRecipe as decoded,
  managedCiPath as ciPath,
  managedOwnership,
  sourceMarker,
  advisoryKey,
  ManagedRecipeRepository,
} from './managed-recipe';
const markerPath = '.system-bootstrapper/wizard-build.json';
const requiredJobs = ['build:wizard', 'test:wizard'];
function reconciliation(build: Row) {
  return {
    build: { ...build, phase: 'requires-reconciliation' },
    message:
      'The initial pipeline request may already have been submitted. Refresh only; no second request will be sent. If no pipeline appears, an administrator must inspect the recorded operation and GitLab state before any explicit repair. Do not clear the checkpoint blindly.',
  };
}
@Injectable()
export class ManagedBuildService {
  validate(input: Row, project: Row): void {
    managedOwnership(input, project);
    const recipe = row(input.recipe),
      build = row(input.build),
      workflow = row(input.workflow);
    ensure(
      recipe.version === 1 &&
        build.version === 1 &&
        build.recipeHash === recipe.recipeHash &&
        /^[a-f0-9]{48}$/.test(text(build.operation)) &&
        /^[a-f0-9]{40}$/.test(text(workflow.importCommit)),
      'Invalid Wizard build reservation',
    );
  }

  async execute(input: Row, project: Row, session: GitlabActivationSession) {
    this.validate(input, project);
    return session.withAdvisoryLock(
      advisoryKey(`system-wizard-build:${project.id}:${row(input.build).operation}`),
      () => this.activate(input, new ManagedRecipeRepository(session, project)),
    );
  }

  private async activate(input: Row, repository: ManagedRecipeRepository) {
    const recipe = row(input.recipe),
      build = row(input.build),
      workflow = row(input.workflow);
    const source = await repository.file('.system-bootstrapper/wizard-source.json');
    ensure(source && decoded(source) === sourceMarker(input), 'Wizard source reservation changed');
    const markerContent = JSON.stringify({
        version: 1,
        operation: build.operation,
        recipeHash: recipe.recipeHash,
        sourceRevision: workflow.sourceRevision,
        importCommit: workflow.importCommit,
      }),
      marker = await repository.file(markerPath);
    let commit: string;
    if (marker) {
      ensure(decoded(marker) === markerContent, 'Wizard build marker changed; refusing overwrite');
      for (const file of files(recipe.files)) {
        const current = await repository.file(text(file.path));
        ensure(
          current &&
            decoded(current) === file.content &&
            current.last_commit_id === marker.last_commit_id,
          'Managed Wizard build recipe changed; use a reviewed upgrade',
        );
      }
      const ci = await repository.file(ciPath);
      ensure(
        ci && decoded(ci) === recipe.ci && ci.last_commit_id === marker.last_commit_id,
        'Managed Wizard CI changed; use a reviewed upgrade',
      );
      commit = text(marker.last_commit_id);
    } else {
      if (input.action === 'wizard-build-status')
        return { build, message: 'Build activation has not installed its recipe yet.' };
      ensure(
        (await repository.head()) === workflow.importCommit,
        'Wizard source changed before build activation; review it first',
      );
      const ci = await repository.file(ciPath);
      ensure(
        ci && decoded(ci) === input.expectedCi,
        'Managed scaffold changed; refusing build activation',
      );
      const actions: Row[] = [];
      for (const file of files(recipe.files)) {
        ensure(
          !(await repository.file(text(file.path))),
          'Wizard build recipe path is occupied; refusing overwrite',
        );
        actions.push({ action: 'create', file_path: file.path, content: file.content });
      }
      actions.push(
        { action: 'create', file_path: markerPath, content: markerContent },
        {
          action: 'update',
          file_path: ciPath,
          content: recipe.ci,
          last_commit_id: ci.last_commit_id,
        },
      );
      const result = row(
        await repository.request(
          'POST',
          'repository/commits',
          {
            branch: repository.project.default_branch,
            commit_message: 'Enable managed Wizard checks [skip ci]',
            actions,
          },
          201,
        ),
      );
      commit = text(result.id);
    }
    await repository.parent(commit, text(workflow.importCommit));
    ensure(
      !build.activationCommit || build.activationCommit === commit,
      'Wizard activation commit changed',
    );
    const state = { ...build, activationCommit: commit, phase: 'recipe-installed' },
      intentKey = 'SYSTEM_WIZARD_PIPELINE_' + build.operation,
      intentValue = JSON.stringify({ version: 1, operation: build.operation, commit });
    let pipeline = await this.pipeline(input, repository, commit);
    const checkpoint = await repository.session.request(
      'GET',
      repository.prefix + 'variables/' + intentKey + '?filter%5Benvironment_scope%5D=%2A',
    );
    ensure([200, 404].includes(checkpoint.status), 'Wizard pipeline checkpoint lookup failed');
    const intent = checkpoint.status === 200 ? row(checkpoint.value) : undefined;
    if (intent)
      ensure(
        intent.value === intentValue &&
          intent.key === intentKey &&
          intent.environment_scope === '*' &&
          intent.variable_type === 'env_var',
        'Wizard pipeline checkpoint changed; inspect before continuing',
      );
    ensure(
      !pipeline || intent,
      'Wizard pipeline has no managed creation checkpoint; inspect before continuing',
    );
    if (!pipeline && intent) return reconciliation(state);
    if (!pipeline && input.action === 'wizard-build') {
      ensure(
        (await repository.head()) === commit,
        'Wizard branch advanced before initial pipeline; review before retrying',
      );
      await repository.request(
        'POST',
        'variables',
        {
          key: intentKey,
          value: intentValue,
          variable_type: 'env_var',
          environment_scope: '*',
          protected: false,
          masked: false,
        },
        201,
      );
      try {
        pipeline = row(
          await repository.request(
            'POST',
            'pipeline',
            {
              ref: repository.project.default_branch,
              variables: [
                { key: 'SYSTEM_WIZARD_OPERATION', value: build.operation },
                { key: 'SYSTEM_WIZARD_EXPECTED_SHA', value: commit },
              ],
            },
            201,
          ),
        );
      } catch {
        return reconciliation(state);
      }
      ensure(
        pipeline.sha === commit,
        'Wizard branch raced pipeline creation; refusing mismatched pipeline',
      );
    }
    if (!pipeline)
      return { build: state, message: 'Recipe installed; no initial pipeline has been started.' };
    return this.evidence(input, repository, pipeline, commit, state);
  }

  private validatePipeline(
    pipeline: Row,
    repository: ManagedRecipeRepository,
    commit: string,
  ): void {
    ensure(
      pipeline.sha === commit &&
        pipeline.source === 'api' &&
        pipeline.ref === repository.project.default_branch &&
        Number.isSafeInteger(pipeline.id) &&
        Number(pipeline.id) > 0,
      'Wizard pipeline identity changed',
    );
  }

  private async pipeline(
    input: Row,
    repository: ManagedRecipeRepository,
    commit: string,
  ): Promise<Row | undefined> {
    const build = row(input.build);
    if (build.pipeline) {
      const id = row(build.pipeline).id;
      ensure(Number.isSafeInteger(id) && Number(id) > 0, 'Wizard pipeline identity changed');
      const pipeline = row(await repository.request('GET', 'pipelines/' + id));
      this.validatePipeline(pipeline, repository, commit);
      return pipeline;
    }
    const matches: Row[] = [];
    let inspected = 0;
    const deadline = Date.now() + 60000;
    for (let page = 1; page <= 20; page++) {
      ensure(
        Date.now() < deadline,
        'Too many pipelines to inspect safely; inspect the existing operation',
      );
      const pipelines = files(
        await repository.request(
          'GET',
          'pipelines?ref=' +
            encodeURIComponent(text(repository.project.default_branch)) +
            '&sha=' +
            commit +
            '&source=api&per_page=100&page=' +
            page,
        ),
      );
      for (const pipeline of pipelines) {
        ensure(
          ++inspected <= 20 && Date.now() < deadline,
          'Too many pipelines to inspect safely; inspect the existing operation',
        );
        ensure(
          Number.isSafeInteger(pipeline.id) && Number(pipeline.id) > 0,
          'Wizard pipeline identity changed',
        );
        const variables = files(
          await repository.request('GET', 'pipelines/' + pipeline.id + '/variables'),
        );
        if (
          !variables.some(
            (variable) =>
              variable.key === 'SYSTEM_WIZARD_OPERATION' && variable.value === build.operation,
          )
        )
          continue;
        this.validatePipeline(pipeline, repository, commit);
        matches.push(pipeline);
      }
      if (pipelines.length < 100) {
        ensure(
          matches.length <= 1,
          'Multiple initial Wizard pipelines found; inspect before retrying',
        );
        return matches[0];
      }
    }
    throw Error('Too many pipelines to inspect safely; inspect the existing operation');
  }

  private async evidence(
    input: Row,
    repository: ManagedRecipeRepository,
    pipeline: Row,
    commit: string,
    state: Row,
  ) {
    this.validatePipeline(pipeline, repository, commit);
    const jobs = files(
        await repository.request('GET', 'pipelines/' + pipeline.id + '/jobs?per_page=100'),
      ),
      selected = requiredJobs.map((name) => jobs.find((job) => job.name === name));
    state.pipeline = {
      id: pipeline.id,
      sha: commit,
      status: pipeline.status,
      webUrl: pipeline.web_url,
    };
    state.checks = Object.fromEntries(
      requiredJobs.map((name, index) => [name, selected[index]?.status ?? 'missing']),
    );
    delete state.artifact;
    state.phase = ['failed', 'canceled', 'skipped', 'manual'].includes(String(pipeline.status))
      ? 'checks-failed'
      : 'pipeline-running';
    if (pipeline.status === 'success') {
      ensure(
        selected.every((job) => job && job.status === 'success' && job.allow_failure === false),
        'Wizard required checks did not succeed',
      );
      const artifact = async (job: Row, name: string) => {
        const value = row(await repository.request('GET', 'jobs/' + job.id + '/artifacts/' + name));
        ensure(
          value.version === 1 &&
            value.sourceCommit === commit &&
            value.pipelineId === pipeline.id &&
            typeof value.imageRef === 'string' &&
            value.imageRef.startsWith(text(input.registryPrefix) + '@sha256:') &&
            /^[a-f0-9]{64}$/.test(value.imageRef.slice(text(input.registryPrefix).length + 8)),
          'Wizard artifact identity or digest is invalid',
        );
        return value;
      };
      const built = await artifact(selected[0]!, 'build-evidence.json'),
        smoke = await artifact(selected[1]!, 'wizard-evidence.json');
      ensure(
        (built.jest === true ||
          (built.unitTests === true &&
            built.testRunner === 'vitest' &&
            built.lint === true &&
            built.typecheck === true)) &&
          built.productionBuild === true &&
          ['http', 'renderedUI', 'projects', 'spa'].every((key) => smoke[key] === true) &&
          (built.testRunner !== 'vitest' ||
            ['configurationBackup', 'cubeSignature'].every((key) => smoke[key] === true)) &&
          built.imageRef === smoke.imageRef,
        'Wizard artifact checks are incomplete',
      );
      state.artifact = { imageRef: built.imageRef, sourceCommit: commit, pipelineId: pipeline.id };
      state.phase = 'candidate-verified';
    }
    return {
      build: state,
      message:
        state.phase === 'candidate-verified'
          ? 'Wizard checks and candidate artifact verified. Production remains unchanged.'
          : 'Wizard pipeline status refreshed. Production remains unchanged.',
    };
  }
}
