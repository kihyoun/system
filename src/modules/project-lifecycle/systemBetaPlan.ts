import { Runtime } from './environmentRuntime';
import { RuntimeContext, ImageRow } from './environmentTypes';
import { BetaBinding, sha, environmentHash, validate } from './systemBetaBinding';
export async function plan(runtime: Pick<Runtime, 'canonical' | 'json'>, input: unknown) {
  const value = input as Partial<BetaBinding>;
  const context = await runtime.canonical<RuntimeContext>('read');
  const environment = context.receipt.wizardWorkflow.environments;

  if (value.operation !== environment.operation) {
    throw new Error('The selected environment reservation changed.');
  }

  const repository = context.receipt.repository;
  const candidate = {
    ...value,
    version: 2,
    sourceLayout: 'system-monorepo-v1',
    mrIid: 0,
    operation: environment.operation,
    wizardProjectId: repository.id,
    wizardProjectPath: repository.path,
    wizardDefaultBranch: repository.defaultBranch,
    environmentHash: environmentHash(environment),
  };
  const binding = validate(candidate, context);
  const legacy = environment.deployments?.review || {};

  if (legacy.active || legacy.pending || legacy.retired?.length) {
    throw new Error('Stop and clean owned legacy System Review resources before Beta migration.');
  }

  const slot = environment.deployments?.beta || {};

  if (slot.active || slot.pending || slot.retired?.length) {
    throw new Error('Stop and reconcile the active Beta before binding another candidate.');
  }

  const image = (await runtime.json<ImageRow[]>(['image', 'inspect', binding.helperImage]))[0];

  if (
    image.Id !== binding.helperImage ||
    image.Config?.Labels?.['org.opencontainers.image.revision'] !== binding.sourceCommit ||
    image.Config?.Labels?.['org.system-bootstrapper.test-job'] !== String(binding.candidateJobId)
  ) {
    throw new Error('The selected immutable helper is not the selected System candidate.');
  }

  const result = {
    binding,
    configurationHash: context.contentHash,
    previousBindingHash: context.systemBetaBindingHash,
  };
  return { ...result, planHash: sha(JSON.stringify(result)) };
}
