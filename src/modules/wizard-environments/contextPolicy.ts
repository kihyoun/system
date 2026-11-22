import type { EnvironmentReceipt, EnvironmentReservation, BuildObservation } from './types';

export function validateManagedBinding(receipt: EnvironmentReceipt, scaffold: string): boolean {
  const primary = receipt.repository.managementMode === 'source-primary';

  if (
    !receipt.defaultProject ||
    receipt.template !== 'wizard' ||
    receipt.state !== 'complete' ||
    !receipt.repository.systemProject ||
    !receipt.repository.id ||
    !receipt.namespaceId ||
    !receipt.operation ||
    (primary
      ? receipt.repository.ciPath !== '.gitlab/primary.yml' ||
        receipt.wizardWorkflow.phase !== 'source-primary' ||
        receipt.sourcePrimary?.version !== 1
      : receipt.repository.ciPath !== '.system-bootstrapper/ci.yml' ||
        receipt.repository.generatedCi !== scaffold ||
        receipt.wizardWorkflow.version !== 1 ||
        receipt.wizardWorkflow.phase !== 'source-imported' ||
        !/^[a-f0-9]{40}$/.test(receipt.wizardWorkflow.importCommit || ''))
  ) {
    throw new Error('Initialize the managed Wizard source before configuring Review and Beta.');
  }

  return primary;
}

export function validateReservation(
  current: EnvironmentReservation | undefined,
  settingsHash: string,
): void {
  if (
    current &&
    (current.version !== 1 ||
      current.settingsHash !== settingsHash ||
      !/^sha256:[a-f0-9]{64}$/.test(current.helperImage) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/.test(current.controller) ||
      !/^[a-f0-9]{48}$/.test(current.operation))
  ) {
    throw new Error(
      'The environment reservation changed. Inspect the server-owned receipt before continuing.',
    );
  }
}

export function registryPrefix(platform: Record<string, string>, projectPath: string): string {
  let registry: URL;
  try {
    registry = new URL(platform.GITLAB_REGISTRY_URL);
  } catch {
    throw new Error('Configure the local GitLab registry before enabling environments.');
  }

  if (
    !['http:', 'https:'].includes(registry.protocol) ||
    registry.username ||
    registry.password ||
    registry.pathname !== '/' ||
    registry.search ||
    registry.hash
  ) {
    throw new Error('Invalid local GitLab registry configuration.');
  }

  if (Number(platform.GITLAB_REGISTRY_DOMAIN_MODE || 0) < 2) {
    registry.port = '5050';
  }

  return registry.host + '/' + projectPath;
}

export function verifiedBuild(
  build: BuildObservation | undefined,
  expectedRecipe: string | undefined,
  registry: string,
): boolean {
  const artifact = build?.artifact,
    expectedRef = registry + '@sha256:';
  return !!(
    build?.version === 1 &&
    expectedRecipe &&
    build.recipeHash === expectedRecipe &&
    build.phase === 'candidate-verified' &&
    /^[a-f0-9]{40}$/.test(build.activationCommit || '') &&
    build.pipeline?.status === 'success' &&
    build.pipeline.sha === build.activationCommit &&
    !!artifact &&
    artifact.sourceCommit === build.activationCommit &&
    artifact.pipelineId === build.pipeline.id &&
    typeof artifact.imageRef === 'string' &&
    artifact.imageRef.startsWith(expectedRef) &&
    /^[a-f0-9]{64}$/.test(artifact.imageRef.slice(expectedRef.length))
  );
}

export function verifiedPrimaryBuild(build: BuildObservation | undefined): boolean {
  return !!(
    build?.version === 1 &&
    build.mode === 'source-primary' &&
    build.phase === 'candidate-verified' &&
    !!build.pipeline &&
    !!build.artifact &&
    typeof build.pipeline.id === 'number' &&
    Number.isSafeInteger(build.pipeline.id) &&
    build.pipeline.id > 0 &&
    /^[a-f0-9]{40}$/.test(build.pipeline.sha || '') &&
    (build.pipeline?.status === 'success' ||
      [
        'created',
        'pending',
        'running',
        'failed',
        'canceled',
        'manual',
        'scheduled',
        'waiting_for_resource',
        'preparing',
      ].includes(build.publishing?.status || '')) &&
    build.artifact.sourceCommit === build.pipeline.sha &&
    build.artifact.pipelineId === build.pipeline.id
  );
}
