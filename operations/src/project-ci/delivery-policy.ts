export interface DeliveryIdentity {
  project: string;
  pipeline: string;
  job: string;
  source: string;
  registryImage: string;
}
export function deliveryIdentity(env: NodeJS.ProcessEnv): DeliveryIdentity {
  const id = (name: string): string => {
    const value = env[name] || '';
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)))
      throw Error(`Positive safe ${name} required`);
    return value;
  };
  const source = env.CI_COMMIT_SHA || '';
  if (!/^[a-f0-9]{40}$/.test(source)) throw Error('Exact source commit required');
  if (env.SYSTEM_WIZARD_EXPECTED_SHA && env.SYSTEM_WIZARD_EXPECTED_SHA !== source)
    throw Error('Source commit does not match binding');
  const registryImage = env.CI_REGISTRY_IMAGE || '';
  if (!/^[a-z0-9][a-z0-9.:-]*\/[a-z0-9][a-z0-9_./-]*$/.test(registryImage))
    throw Error('Job registry image required');
  return {
    project: id('CI_PROJECT_ID'),
    pipeline: id('CI_PIPELINE_ID'),
    job: id('CI_JOB_ID'),
    source,
    registryImage,
  };
}
export function candidateReference(value: string, identity: DeliveryIdentity): string {
  const prefix = identity.registryImage + '@sha256:';
  if (!value.startsWith(prefix) || !/^[a-f0-9]{64}$/.test(value.slice(prefix.length)))
    throw Error('Exact candidate digest from job registry required');
  return value;
}
export const BUILDKIT_IMAGE =
  'moby/buildkit:buildx-stable-1@sha256:cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea';
