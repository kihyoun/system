import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { createEvidence } from './evidence';
import { checkoutIdentity, imageId, record, wizardImageRevision } from './source-identity';
import type { Environment, Execute, SuccessorRelease } from './types';
export const sha256 = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex');
interface InspectedImage {
  Id: string;
  Config?: { Labels?: Record<string, string> };
  RepoDigests?: string[];
}
export function publishSuccessor(
  evidence: ReturnType<typeof createEvidence>,
  execute: Execute,
  env: Environment = process.env,
  root = process.cwd(),
): SuccessorRelease {
  const { context, candidates, validateEvidence } = evidence;
  const ci = context(env);
  const receipts = candidates(path.join(root, 'test-results/e2e'), ci);
  if (receipts.length !== 1)
    throw Error('Exactly one full successor acceptance receipt is required.');
  const { proof, bytes } = receipts[0];
  const expectedId = validateEvidence(proof, ci);
  const tag = ci.registryRepository + ':pipeline-' + ci.pipelineId + '-job-' + ci.candidateJobId;
  const local = 'system-platform-candidate:ci-' + ci.projectId + '-' + ci.candidateJobId;
  const wizardRepository = ci.registryRepository + '-wizard';
  const wizardTag = wizardRepository + ':pipeline-' + ci.pipelineId + '-job-' + ci.candidateJobId;
  const wizardLocal = 'system-platform-wizard:ci-' + ci.projectId + '-' + ci.candidateJobId;
  const inspect = (reference: string): InspectedImage => {
    const rows: unknown = JSON.parse(execute('docker', ['image', 'inspect', reference]));
    if (!Array.isArray(rows) || rows.length !== 1 || !imageId(record(rows[0]).Id))
      throw Error('Invalid image inspection.');
    return rows[0] as InspectedImage;
  };
  const source = checkoutIdentity(root, ci.sourceRevision, execute);
  evidence.validateEvidence(proof, { ...ci, ...source });
  const image = inspect(local);
  if (
    image.Id !== expectedId ||
    image.Config?.Labels?.['org.system-bootstrapper.test-job'] !== String(ci.candidateJobId) ||
    image.Config?.Labels?.['org.opencontainers.image.revision'] !== ci.sourceRevision
  )
    throw Error('The accepted image/source/job identity does not match.');
  const wizard = inspect(wizardLocal);
  if (
    !imageId(proof.images.wizard) ||
    wizard.Id !== proof.images.wizard ||
    wizard.Config?.Labels?.['org.system-bootstrapper.test-job'] !== String(ci.candidateJobId) ||
    wizard.Config?.Labels?.['org.opencontainers.image.revision'] !== wizardImageRevision(source) ||
    wizard.Config?.Labels?.['org.system-bootstrapper.source-revision'] !== ci.sourceRevision
  )
    throw Error('The accepted Wizard image/source/job identity does not match.');
  if (!env.CI_REGISTRY_USER || !env.CI_REGISTRY_PASSWORD)
    throw Error('Scoped CI registry credentials are required.');
  const output = path.join(root, 'test-results/successor');
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  // This directory MUST stay outside every artifact path. Finally cannot run
  // after SIGKILL; even then a job must never upload its registry credentials.
  const auth = fs.mkdtempSync(path.join(os.tmpdir(), 'system-successor-registry-'));
  fs.chmodSync(auth, 0o700);
  const dockerEnv = { ...env, DOCKER_CONFIG: auth };
  const tagged: [string, string][] = [];
  try {
    execute(
      'docker',
      ['login', '--username', env.CI_REGISTRY_USER, '--password-stdin', env.CI_REGISTRY!],
      { env: dockerEnv, input: env.CI_REGISTRY_PASSWORD },
    );
    execute('docker', ['tag', local, tag]);
    tagged.push([tag, expectedId]);
    execute('docker', ['push', tag], { env: dockerEnv });
    const published = inspect(tag);
    if (published.Id !== expectedId) throw Error('Published image identity changed.');
    const refs = (published.RepoDigests || []).filter(
      (ref) => ref.startsWith(ci.registryRepository + '@') && imageId(ref.split('@')[1]),
    );
    if (refs.length !== 1) throw Error('An immutable published successor reference is required.');
    execute('docker', ['tag', wizardLocal, wizardTag]);
    tagged.push([wizardTag, wizard.Id]);
    execute('docker', ['push', wizardTag], { env: dockerEnv });
    const publishedWizard = inspect(wizardTag);
    const wizardRefs = (publishedWizard.RepoDigests || []).filter(
      (ref) => ref.startsWith(wizardRepository + '@') && imageId(ref.split('@')[1]),
    );
    if (publishedWizard.Id !== wizard.Id || wizardRefs.length !== 1)
      throw Error('An immutable published Wizard reference is required.');
    const receipt: SuccessorRelease = {
      format: 'system-successor-release-v1',
      ...ci,
      ...source,
      imageId: expectedId,
      registryReference: refs[0],
      candidateEvidenceSha256: sha256(bytes),
      wizardImageId: wizard.Id,
      wizardRegistryReference: wizardRefs[0],
      candidateEvidencePath: 'test-results/successor/candidate-results.json',
    };
    // E2E after_script cleanup rewrites its working receipts. Freeze exactly
    // the accepted bytes used here so the uploaded release hash stays valid.
    fs.writeFileSync(path.join(output, 'candidate-results.json'), bytes, { mode: 0o600 });
    fs.writeFileSync(path.join(output, 'release.json'), JSON.stringify(receipt, null, 2) + '\n', {
      mode: 0o600,
    });
    return receipt;
  } finally {
    fs.rmSync(auth, { recursive: true, force: true });
    for (const [reference, expected] of tagged.reverse()) {
      if (inspect(reference).Id !== expected)
        throw Error('Cannot clean a changed successor publication alias.');
      execute('docker', ['image', 'rm', reference]);
    }
  }
}
