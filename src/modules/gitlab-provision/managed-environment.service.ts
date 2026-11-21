import { Injectable } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
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
const markerPath = '.system-bootstrapper/wizard-environments.json';
function fields(environment: Row, recipe: Row): Row {
  return {
    version: 1,
    operation: environment.operation,
    recipeHash: recipe.recipeHash,
    settingsHash: environment.settingsHash,
    helperImage: environment.helperImage,
    controller: environment.controller,
  };
}
function matches(marker: Row | undefined, environment: Row, recipe: Row): boolean {
  if (!marker) return false;
  try {
    const parsed = row(JSON.parse(decoded(marker))),
      { parentCommit, ...identity } = parsed;
    return (
      isDeepStrictEqual(identity, fields(environment, recipe)) &&
      /^[a-f0-9]{40}$/.test(String(parentCommit))
    );
  } catch {
    return false;
  }
}
@Injectable()
export class ManagedEnvironmentService {
  validate(input: Row, project: Row): void {
    managedOwnership(input, project);
    const environment = row(input.environments),
      recipe = row(input.recipe);
    ensure(
      environment.version === 1 &&
        recipe.version === 1 &&
        /^[a-f0-9]{48}$/.test(text(environment.operation)) &&
        environment.recipeHash === recipe.recipeHash &&
        environment.settingsHash === recipe.settingsHash &&
        environment.helperImage === recipe.helperImage &&
        environment.controller === 'system_bootstrapper_1' &&
        input.controller === 'system_bootstrapper_1',
      'Invalid environment reservation',
    );
    const build = row(input.build),
      legacy = row(input.legacyRecipe);
    ensure(
      build.version === 1 &&
        build.recipeHash === legacy.recipeHash &&
        /^[a-f0-9]{40}$/.test(text(build.activationCommit)) &&
        build.phase === 'candidate-verified' &&
        typeof row(build.artifact).imageRef === 'string' &&
        text(row(build.artifact).imageRef).startsWith(text(input.registryPrefix) + '@sha256:') &&
        /^[a-f0-9]{64}$/.test(
          text(row(build.artifact).imageRef).slice(text(input.registryPrefix).length + 8),
        ),
      'A verified managed Wizard build is required',
    );
  }

  async execute(input: Row, project: Row, session: GitlabActivationSession) {
    this.validate(input, project);
    return session.withAdvisoryLock(advisoryKey(`system-wizard-environments:${project.id}`), () =>
      this.install(input, new ManagedRecipeRepository(session, project)),
    );
  }

  private async install(input: Row, repository: ManagedRecipeRepository) {
    const environment = row(input.environments),
      recipe = row(input.recipe),
      build = row(input.build),
      legacy = row(input.legacyRecipe),
      workflow = row(input.workflow);
    await repository.matching('.system-bootstrapper/wizard-source.json', sourceMarker(input));
    await repository.matching(
      '.system-bootstrapper/wizard-build.json',
      JSON.stringify({
        version: 1,
        operation: build.operation,
        recipeHash: legacy.recipeHash,
        sourceRevision: workflow.sourceRevision,
        importCommit: workflow.importCommit,
      }),
      text(build.activationCommit),
    );
    for (const source of files(legacy.files))
      await repository.matching(
        text(source.path),
        text(source.content),
        text(build.activationCommit),
      );
    const current = await repository.file(markerPath);
    const verified = async (
      marker: Row | undefined,
      expected: Row,
      expectedRecipe: Row,
      commit?: string,
    ) => {
      ensure(
        matches(marker, expected, expectedRecipe) &&
          marker &&
          (!commit || marker.last_commit_id === commit),
        'Managed environment marker changed; refusing overwrite',
      );
      await repository.parent(
        text(marker.last_commit_id),
        text(row(JSON.parse(decoded(marker))).parentCommit),
      );
      return marker;
    };
    const installed = (commit: string) => ({
      environments: { ...environment, activationCommit: commit, phase: 'recipe-installed' },
      message:
        'Managed environment recipe installed. No pipeline was started; candidate deployment remains manual.',
    });
    if (matches(current, environment, recipe)) {
      const marker = await verified(current, environment, recipe),
        commit = text(marker.last_commit_id);
      await repository.matching(ciPath, text(recipe.ci), commit);
      for (const source of files(recipe.files))
        await repository.matching(text(source.path), text(source.content), commit);
      ensure(
        !environment.activationCommit || environment.activationCommit === commit,
        'Wizard environment activation identity changed',
      );
      return installed(commit);
    }
    if (input.action === 'wizard-environments-status' && !current)
      return { environments: environment, message: 'Environment recipe has not been installed.' };
    const previous = input.previousEnvironments ? row(input.previousEnvironments) : undefined;
    let ci: Row;
    if (previous) {
      const previousRecipe = row(input.previousRecipe);
      ensure(
        previous.activationCommit &&
          previous.recipeHash === previousRecipe.recipeHash &&
          previous.settingsHash === previousRecipe.settingsHash,
        'Previous environment checkpoint is incomplete',
      );
      ensure(
        !Object.values(row(previous.deployments ?? {})).some(
          (value) => row(value).active || row(value).pending,
        ),
        'Stop active and reconcile pending environments before settings updates',
      );
      await verified(current, previous, previousRecipe, text(previous.activationCommit));
      ci = await repository.matching(
        ciPath,
        text(previousRecipe.ci),
        text(previous.activationCommit),
      );
      for (const source of files(previousRecipe.files))
        await repository.matching(
          text(source.path),
          text(source.content),
          text(previous.activationCommit),
        );
      ensure(
        isDeepStrictEqual(
          files(previousRecipe.files)
            .map((v) => v.path)
            .sort(),
          files(recipe.files)
            .map((v) => v.path)
            .sort(),
        ),
        'Unsupported managed environment recipe path migration',
      );
    } else {
      ensure(!current, 'Environment path occupied; refusing overwrite');
      ci = await repository.matching(ciPath, text(legacy.ci), text(build.activationCommit));
      for (const source of files(recipe.files))
        ensure(
          !(await repository.file(text(source.path))),
          'Environment recipe path occupied; refusing overwrite',
        );
    }
    if (input.action === 'wizard-environments-status')
      return {
        environments: environment,
        message: 'Environment upgrade is pending explicit activation.',
      };
    const head = await repository.head(),
      actions: Row[] = [];
    for (const source of files(recipe.files))
      actions.push({
        action: previous ? 'update' : 'create',
        file_path: source.path,
        content: source.content,
        ...(previous
          ? { last_commit_id: (await repository.file(text(source.path)))?.last_commit_id }
          : {}),
      });
    actions.push(
      {
        action: current ? 'update' : 'create',
        file_path: markerPath,
        content: JSON.stringify({ ...fields(environment, recipe), parentCommit: head }),
        ...(current ? { last_commit_id: current.last_commit_id } : {}),
      },
      {
        action: 'update',
        file_path: ciPath,
        content: recipe.ci,
        last_commit_id: ci.last_commit_id,
      },
    );
    let result: Row;
    try {
      result = row(
        await repository.request(
          'POST',
          'repository/commits',
          {
            branch: repository.project.default_branch,
            commit_message: 'Configure managed Wizard candidate environments [skip ci]',
            actions,
          },
          201,
        ),
      );
    } catch {
      return {
        environments: { ...environment, phase: 'requires-reconciliation' },
        message:
          'Environment recipe commit may have completed. Refresh the same reservation before retrying.',
      };
    }
    const commit = text(result.id);
    await repository.parent(commit, head);
    return installed(commit);
  }
}
