import * as diagnostics from './job-diagnostics';
import {
  object,
  fields,
  positive,
  sha,
  hash,
  image,
  boolean,
  oneOf,
  identity,
  operation,
  pipelineStatuses,
  stagesPassed,
  type EvidenceObject,
} from './evidence-values';
export const requiredJobs = ['build:source', 'test:browser', 'build:wizard', 'test:wizard'];
export const stages = [
  'guided-preview-fresh-public-registration',
  'guided-preview-native-source-push-and-build',
  'guided-preview-native-evidence-adoption',
  'guided-preview-native-review-deploy-stop',
  'guided-preview-native-review-stop',
  'guided-preview-native-merge-and-build',
  'guided-preview-native-beta-deploy-stop',
  'guided-preview-native-beta-stop',
  'guided-preview-production-retained',
  'guided-preview-temporary-credential-revoked',
];
const contexts = ['source', 'review', 'merge', 'beta'];
function jobDetails(job: EvidenceObject): EvidenceObject {
  const clean: EvidenceObject = {};
  fields(job, clean, ['runnerId', 'pipelineId'], positive);
  fields(job, clean, ['sourceCommit'], sha);
  const failureReason = diagnostics.failureReason(job.failureReason);
  if (failureReason) clean.failureReason = failureReason;
  const diagnostic = diagnostics.sanitize(job.diagnostics);
  if (diagnostic) clean.diagnostics = diagnostic;
  return clean;
}
export function sanitize(input: unknown): EvidenceObject | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const value = object(input),
    clean: EvidenceObject = {};
  fields(value, clean, ['initialRegistrationId', 'adoptedProjectId'], positive);
  fields(value, clean, ['productionMainSha256'], hash);
  fields(value, clean, ['productionImageId'], image);
  fields(value, clean, ['betaEnabled', 'credentialCleanupUncertain'], boolean);
  if (value.setup && typeof value.setup === 'object') {
    const source = object(value.setup),
      setup: EvidenceObject = {};
    fields(
      source,
      setup,
      ['phase'],
      oneOf(
        'not-started',
        'preflight',
        'source-registration',
        'waiting-build',
        'binding',
        'environments',
        'ready',
        'needs-inspection',
        'needs-attention',
      ),
    );
    fields(source, setup, ['state'], oneOf('running', 'complete', 'completed', 'failed'));
    fields(source, setup, ['uncertain'], boolean);
    fields(
      source,
      setup,
      ['uncertainAction'],
      oneOf(
        'preview-source-push',
        'preview-setup-project',
        'preview-setup-revoke',
        'preview-setup-system',
      ),
    );
    fields(source, setup, ['failureCode'], (code) => !!diagnostics.setupFailureCode(code));
    fields(source, setup, ['projectId', 'pipelineId'], positive);
    fields(source, setup, ['pipelineStatus'], oneOf(...pipelineStatuses));
    if (Object.keys(setup).length) clean.setup = setup;
  }
  if (Array.isArray(value.previousProjectIds))
    clean.previousProjectIds = value.previousProjectIds.filter(positive).slice(0, 100);
  if (value.productionRetained) {
    const retained: EvidenceObject = {},
      source = object(value.productionRetained);
    fields(source, retained, ['mainSha256'], hash);
    fields(source, retained, ['runningImage'], image);
    clean.productionRetained = retained;
  }
  for (const context of contexts) {
    if (!value[context] || typeof value[context] !== 'object') continue;
    const row = object(value[context]),
      item: EvidenceObject = {};
    fields(row, item, ['projectId', 'systemProjectId', 'pipelineId', 'mergeRequestIid'], positive);
    fields(row, item, ['sourceCommit', 'mergeCommit'], sha);
    fields(row, item, ['source'], oneOf('push', 'merge_request_event'));
    fields(row, item, ['pipelineStatus'], oneOf(...pipelineStatuses));
    fields(row, item, ['merged', 'normalGate', 'artifactsVerified'], boolean);
    fields(row, item, ['imageDigest'], image);
    if (Array.isArray(row.jobs))
      item.jobs = row.jobs
        .map(object)
        .filter(
          (job) =>
            positive(job.id) &&
            typeof job.name === 'string' &&
            requiredJobs.includes(job.name) &&
            typeof job.status === 'string' &&
            pipelineStatuses.includes(job.status),
        )
        .slice(0, 8)
        .map((job) => ({ id: job.id, name: job.name, status: job.status, ...jobDetails(job) }));
    for (const action of ['deploy', 'stop']) {
      const job = object(row[action]);
      if (
        positive(job.id) &&
        job.name === action + ':' + context &&
        typeof job.status === 'string' &&
        ['manual', 'success', 'failed', 'canceled', 'running', 'pending'].includes(job.status)
      )
        item[action] = {
          id: job.id,
          name: job.name,
          status: job.status,
          ...(positive(job.runnerId) ? { runnerId: job.runnerId } : {}),
        };
    }
    for (const key of ['deployment', 'stopped'])
      if (row[key] && typeof row[key] === 'object') item[key] = identity(row[key]);
    fields(row, item, ['stoppedThroughPipelineId'], positive);
    fields(row, item, ['containerRemoved'], boolean);
    clean[context] = item;
  }
  return Object.keys(clean).length ? clean : undefined;
}
export function validate(
  value: unknown,
  results: unknown,
): EvidenceObject & { productionImageId: string } {
  const proof = sanitize(value),
    fail = () => {
      throw Error('Complete native guided preview lifecycle evidence is required.');
    };
  if (!proof) throw Error('Complete native guided preview lifecycle evidence is required.');
  const retained = object(proof.productionRetained);
  if (
    proof.credentialCleanupUncertain === true ||
    proof.betaEnabled !== true ||
    !positive(proof.initialRegistrationId) ||
    !positive(proof.adoptedProjectId) ||
    proof.initialRegistrationId === proof.adoptedProjectId ||
    !Array.isArray(proof.previousProjectIds) ||
    proof.previousProjectIds.includes(proof.adoptedProjectId) ||
    !hash(proof.productionMainSha256) ||
    !image(proof.productionImageId) ||
    retained.mainSha256 !== proof.productionMainSha256 ||
    retained.runningImage !== proof.productionImageId ||
    !stagesPassed(results, stages)
  )
    fail();
  for (const context of contexts) {
    const row = object(proof[context]),
      jobs = Array.isArray(row.jobs) ? row.jobs.map(object) : [];
    if (
      row.projectId !== proof.adoptedProjectId ||
      !positive(row.pipelineId) ||
      !sha(row.sourceCommit) ||
      row.source !== (context === 'review' ? 'merge_request_event' : 'push') ||
      row.artifactsVerified !== true ||
      !image(row.imageDigest) ||
      new Set(jobs.map((job) => job.id)).size !== 4 ||
      !requiredJobs.every(
        (name) =>
          jobs.filter((job) => job.name === name).length === 1 &&
          jobs.find((job) => job.name === name)?.status === 'success' &&
          positive(jobs.find((job) => job.name === name)?.runnerId),
      )
    )
      fail();
  }
  const source = object(proof.source),
    review = object(proof.review),
    merge = object(proof.merge),
    beta = object(proof.beta);
  if (
    new Set([source.pipelineId, review.pipelineId, merge.pipelineId]).size !== 3 ||
    merge.normalGate !== true ||
    merge.merged !== true ||
    !positive(review.mergeRequestIid) ||
    merge.mergeRequestIid !== review.mergeRequestIid ||
    merge.mergeCommit !== merge.sourceCommit ||
    merge.sourceCommit === source.sourceCommit ||
    object(review.deployment).operation !== object(beta.deployment).operation ||
    beta.pipelineId !== merge.pipelineId ||
    beta.sourceCommit !== merge.sourceCommit ||
    beta.imageDigest !== merge.imageDigest
  )
    fail();
  for (const context of ['review', 'beta']) {
    const row = object(proof[context]),
      active = object(row.deployment),
      stopped = object(row.stopped),
      deploy = object(row.deploy),
      stop = object(row.stop);
    if (
      deploy.id === stop.id ||
      ![deploy, stop].every((job) => job.status === 'success' && positive(job.runnerId)) ||
      active.state !== 'active' ||
      stopped.state !== 'stopped' ||
      active.projectId !== proof.adoptedProjectId ||
      active.pipelineId !== row.pipelineId ||
      active.jobId !== deploy.id ||
      active.sourceCommit !== row.sourceCommit ||
      active.mrIid !== (context === 'review' ? row.mergeRequestIid : 0) ||
      !operation(active.operation) ||
      active.generation !== 'p' + row.pipelineId + '-j' + deploy.id ||
      active.imageDigest !== row.imageDigest ||
      ![
        'projectId',
        'pipelineId',
        'jobId',
        'sourceCommit',
        'mrIid',
        'operation',
        'generation',
        'imageDigest',
      ].every((key) => active[key] === stopped[key]) ||
      !positive(row.stoppedThroughPipelineId) ||
      !positive(row.pipelineId) ||
      row.stoppedThroughPipelineId < row.pipelineId ||
      row.containerRemoved !== true
    )
      fail();
  }
  return proof as EvidenceObject & { productionImageId: string };
}
