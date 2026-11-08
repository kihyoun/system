'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Runtime} = require('../wizard-environments/helper');
const {validate} = require('./binding');
const WORK_BUDGET = 360000, CLEANUP_BUDGET = 220000;
function request(action, env) {
  if (!['deploy', 'stop'].includes(action)) throw new Error('Use deploy or stop.');
  return require('../wizard-environments/state').validRequest({action, kind: 'review', delivery: 'system',
    projectId: Number(env.CI_PROJECT_ID), pipelineId: Number(env.CI_PIPELINE_ID), jobId: Number(env.CI_JOB_ID),
    mrIid: Number(env.CI_MERGE_REQUEST_IID), sourceCommit: env.CI_COMMIT_SHA, operation: env.SYSTEM_REVIEW_OPERATION});
}
async function run(action, env = process.env, options = {}) {
  const selected = request(action, env), Driver = options.Runtime || Runtime, runtime = new Driver(selected);
  const now = options.now || Date.now, workDeadline = now() + WORK_BUDGET;
  let cleanupDeadline;
  runtime.deadline = workDeadline;
  const command = runtime.command.bind(runtime);
  runtime.command = (args, input = '', settings = {}) => {
    const remaining = (settings.cleanup ? cleanupDeadline : workDeadline) - now();
    if (!(remaining > 0)) return Promise.reject(new Error('System Review operation exceeded its reserved time budget.'));
    return command(args, input, {...settings, timeout: Math.min(settings.timeout || 180000, remaining)});
  };
  let helperId, auth, client, createAttempted = false;
  const cleanup = async () => {
    if (auth) { fs.rmSync(auth, {recursive: true, force: true}); auth = null; }
    if (client) { fs.rmSync(client, {recursive: true, force: true}); client = null; }
    if (!helperId && createAttempted) {
      const existing = await runtime.inspected(runtime.helperName, 'container', true);
      if (existing) {
        if (existing.image !== binding.helperImage || existing.labels?.['system.wizard.environments.helper'] !== selected.operation)
          throw new Error('System review helper name belongs to another owner.');
        helperId = (await runtime.json(['container', 'inspect', runtime.helperName], '', {cleanup: true, timeout: 15000}))[0].Id;
      }
    }
    if (!helperId) return;
    if (!/^[a-f0-9]{64}$/.test(helperId)) throw new Error('Invalid helper cleanup identity.');
    const own = (await runtime.json(['container', 'inspect', helperId], '', {cleanup: true, timeout: 15000}))[0];
    if (own.Id !== helperId || own.Config?.Labels?.['system.wizard.environments.helper'] !== selected.operation ||
        own.Image !== binding.helperImage) throw new Error('System review helper ownership changed.');
    await runtime.command(['stop', '--time', '120', helperId], '', {cleanup: true, timeout: 130000, release: true});
    await runtime.command(['rm', '-f', helperId], '', {cleanup: true, timeout: 15000, release: true});
    helperId = null;
  };
  const signal = () => runtime.cancel();
  process.once('SIGTERM', signal); process.once('SIGINT', signal);
  let binding;
  try {
    const context = await runtime.canonical('read');
    binding = validate(context.systemReviewBinding, context, selected);
    if (env.WIZARD_REVIEW_HOST !== context.receipt.wizardWorkflow.environments.settings.review.host)
      throw new Error('Displayed Review host does not match the configured HTTPS route.');
    if (action === 'deploy') {
      const release = options.release || JSON.parse(fs.readFileSync('test-results/successor/release.json', 'utf8'));
      if (release.sourceRevision !== selected.sourceCommit || release.projectId !== selected.projectId ||
          release.pipelineId !== selected.pipelineId || release.imageId !== binding.helperImage ||
          release.wizardRegistryReference !== binding.wizardImageRef ||
          !/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/.test(env.CI_REGISTRY || '') ||
          release.registryReference !== env.CI_REGISTRY_IMAGE + '/successor@' + release.registryReference?.split('@')[1] ||
          !/^sha256:[a-f0-9]{64}$/.test(release.registryReference?.split('@')[1] || ''))
        throw new Error('Review artifacts do not match the explicitly authorized candidate.');
      auth = fs.mkdtempSync(path.join(os.tmpdir(), 'system-review-registry-'));
      const docker = ['--config', auth];
      await runtime.command([...docker, 'login', '--username', env.CI_REGISTRY_USER, '--password-stdin', env.CI_REGISTRY], env.CI_REGISTRY_PASSWORD, {timeout: 30000});
      for (const image of [release.registryReference, binding.wizardImageRef])
        await runtime.command([...docker, 'pull', image], '', {timeout: 180000});
      fs.rmSync(auth, {recursive: true, force: true}); auth = null;
    }
    const image = (await runtime.json(['image', 'inspect', binding.helperImage]))[0];
    if (image.Id !== binding.helperImage) throw new Error('Retain the exact reviewed helper image for Stop.');
    const args = ['create', '--name', runtime.helperName, '--network', 'none', '--read-only', '--memory', '256m', '--cpus', '1',
      '--pids-limit', '128', '--tmpfs', '/tmp:rw,nosuid,noexec,size=16m',
      '--label', 'system.wizard.environments.helper=' + selected.operation,
      '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
      '--mount', 'type=volume,source=system_templates,target=/templates',
      '--mount', 'type=volume,source=system_ssl,target=/ssl,readonly',
      '--entrypoint', 'node', binding.helperImage, '/system/project-bootstrap/wizard-environments/helper.js',
      '--action', action, '--kind', 'review', '--project', String(selected.projectId), '--pipeline', String(selected.pipelineId),
      '--job', String(selected.jobId), '--sha', selected.sourceCommit, '--mr', String(selected.mrIid),
      '--operation', selected.operation, '--controller', 'system_bootstrapper_1', '--delivery', 'system'];
    client = fs.mkdtempSync(path.join(os.tmpdir(), 'system-review-client-'));
    fs.writeFileSync(path.join(client, 'config.json'), '{}\n');
    if (await runtime.inspected(runtime.helperName)) throw new Error('System review helper name already exists; inspect its owner.');
    createAttempted = true;
    helperId = await runtime.command(['--config', client, ...args], '', {timeout: 15000});
    if (!/^[a-f0-9]{64}$/.test(helperId)) throw new Error('Invalid helper identity.');
    console.log(await runtime.command(['start', '--attach', helperId], '', {timeout: 480000}));
  } finally {
    runtime.cleanupDeadline = cleanupDeadline = now() + CLEANUP_BUDGET;
    try { await cleanup(); }
    finally { process.removeListener('SIGTERM', signal); process.removeListener('SIGINT', signal); }
  }
}
if (require.main === module) {
  if (process.argv.length !== 3) { console.error('Use deploy or stop.'); process.exitCode = 2; }
  else run(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = {request, run, WORK_BUDGET, CLEANUP_BUDGET};
