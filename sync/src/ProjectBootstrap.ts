import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import md5 from 'md5';
import {applicationTemplates, prepareApplication} from './ApplicationTemplates';
import {spawn, execFile} from 'child_process';

export const validProjectKey = (key: any) => typeof key === 'string' && /^[a-z0-9]+$/.test(key);
const directory = path.resolve('../system/.projects.env');
const jobs = new Map<string, any>();
const active = new Set<string>();
export const projectBusy = () => active.size > 0;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const receiptLine = '# BOOTSTRAPPER_PROJECT=';

export function validateProject(input: any) {
  if (!validProjectKey(input.projectKey) || !/^[1-9][0-9]*$/.test(String(input.namespaceId))) {
    throw new Error('Project Key must contain only lowercase a-z and digits 0-9; select a namespace.');
  }
  if (typeof input.data !== 'string' || input.data.substr(807, 1) !== '$' ||
    md5(input.data.substr(0, 1184)) !== 'bd4a8426355824593a5e21ad759830c1') {
    throw new Error('Invalid configuration signature.');
  }
  // These files are sourced by existing infrastructure scripts. Accept only
  // literal assignments from the established project generator, never shell code.
  const values: any = {};
  for (const line of input.data.substr(1184).split('\n')) {
    if (!line.trim() || line.startsWith('#')) { continue; }
    const match = /^(?:export )?([A-Z_]+)="([A-Za-z0-9_./:@+*-]*)"\s*$/.exec(line);
    if (!match || !/^(PROJECT_NAME|PROJECT_TEMPLATE|USE_(PROD|BETA|REVIEW)_HOST|(PROD|BETA|REVIEW)_(HOST|DOMAIN_MODE|DEPLOY_MODE|SSL|SSL_KEY)|GITLAB_RUNNER_(TOKEN|SCALE))$/.test(match[1])) {
      throw new Error('Invalid project configuration assignment.');
    }
    if (values[match[1]] !== undefined) { throw new Error('Duplicate configuration assignment.'); }
    values[match[1]] = match[2];
  }
  for (const environment of ['PROD', 'BETA', 'REVIEW']) {
    if (!['true', 'false'].includes(values['USE_' + environment + '_HOST'])) {
      throw new Error('Invalid environment enable setting.');
    }
    if (values['USE_' + environment + '_HOST'] === 'true') {
      const host = values[environment + '_HOST'] || '';
      if (host.length > 253 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(host)) {
        throw new Error('Configure a valid ' + environment + ' host before Save.');
      }
    }
    for (const setting of ['DOMAIN_MODE', 'DEPLOY_MODE']) {
      const value = values[environment + '_' + setting];
      if ((value !== undefined || values['USE_' + environment + '_HOST'] === 'true') && !(setting === 'DOMAIN_MODE' ? /^[0-3]$/ : /^[01]$/).test(value || '')) {
        throw new Error('Invalid environment mode.');
      }
    }
  }
  if (values.PROJECT_NAME !== input.projectKey) { throw new Error('Project Key does not match configuration.'); }
  if (!applicationTemplates.includes(input.template || 'empty')) { throw new Error('Select a supported application template.'); }
  if (values.PROJECT_TEMPLATE !== undefined && values.PROJECT_TEMPLATE !== (input.template || 'empty')) { throw new Error('Template does not match configuration.'); }
  if (['empty', 'wizard'].includes(input.template || 'empty') && (typeof input.ci !== 'string' || input.ci.length > 200000 || !input.ci.includes('CI_DEFAULT_BRANCH'))) {
    throw new Error('Missing generated CI configuration.');
  }
  return values;
}

let railsWorkers = 0;
const railsQueue: Array<() => void> = [];
export async function rails(input: any): Promise<any> {
  if (railsQueue.length >= 50) { throw new Error('GitLab setup queue is busy. Retry shortly.'); }
  if (railsWorkers >= 2) { await new Promise<void>((resolve) => railsQueue.push(resolve)); }
  railsWorkers++;
  try { return await runRails(input); } finally {
    railsWorkers--;
    const next = railsQueue.shift();
    if (next) { next(); }
  }
}
function runRails(input: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(JSON.stringify(input)).toString('base64');
    const modules: {[key: string]: string} = {'wizard-source': 'wizard-source/import.rb',
      'wizard-build': 'wizard-build/activate.rb', 'wizard-build-status': 'wizard-build/activate.rb'};
    const importer = modules[input.action] ? fs.readFileSync(path.join(__dirname, '../../project-bootstrap', modules[input.action]), 'utf8') + '\n' : '';
    const script = `BOOTSTRAPPER_INPUT = '${encoded}'\n` + importer + fs.readFileSync(path.join(__dirname, '../../project-bootstrap/provision.rb'), 'utf8');
    const child = spawn('docker', ['exec', '-i', 'system_gitlab_1', 'gitlab-rails', 'runner', '-']);
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('GitLab setup timed out; retry to recover the same operation.')); }, 240000);
    child.stdout.on('data', (data) => { if (output.length < 2000000) { output += data; } });
    // Rails diagnostics can contain a temporary PAT. Never expose them.
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(new Error('Could not access the local GitLab container.')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(new Error('GitLab operation failed; check readiness and retry.')); return; }
      try { resolve(JSON.parse(output.trim().split('\n').pop())); } catch (_) { reject(new Error('Invalid GitLab response.')); }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(script);
  });
}

export function readReceipt(content: string) {
  const line = content.split('\n').find((item) => item.startsWith(receiptLine));
  return line ? JSON.parse(Buffer.from(line.substr(receiptLine.length), 'base64').toString('utf8')) : undefined;
}
export function writeReceipt(file: string, data: string, receipt: any) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, data + '\n' + receiptLine + Buffer.from(JSON.stringify(receipt)).toString('base64') + '\n', {mode: 0o600});
  fs.renameSync(temporary, file);
}
function trimJobs() {
  for (const [key, previous] of jobs) {
    if (previous.state !== 'running' && Date.now() - previous.created > 900000) { jobs.delete(key); }
  }
  while (jobs.size >= 200) {
    const completed = Array.from(jobs).find((entry) => entry[1].state !== 'running');
    if (!completed) { break; }
    jobs.delete(completed[0]);
  }
}
export function withProjectLock(id: string, operation: () => any) {
  if (active.size > 0) { throw new Error('Another project operation is running. Retry after it completes.'); }
  active.add(id);
  try { return operation(); } catch (error) { active.delete(id); throw error; }
}
export function startJob(id: string, operation: () => Promise<any>) {
  trimJobs();
  const job: any = {id, state: 'running', created: Date.now()};
  jobs.set(id, job);
  operation().then((result) => Object.assign(job, result, {state: result.state || 'complete'}))
    .catch((error) => Object.assign(job, {state: 'failed', message: error.message}))
    .finally(() => active.delete(id));
  return job;
}
export function lookupJob(id: string) { return jobs.get(id); }
export function queryGitlab(input: any) {
  trimJobs();
  if (jobs.size >= 200) { throw new Error('Too many pending operations. Retry shortly.'); }
  const id = digest(JSON.stringify(input));
  const previous = jobs.get(id);
  if (previous && previous.state === 'running') { return previous; }
  return startJob(id, () => rails(input));
}
export function createProject(input: any, defaultProject = false) {
  if (input.template === 'wizard' && !defaultProject) { throw new Error('The system Wizard project is managed automatically.'); }
  const settings = validateProject(input);
  input = {...input, files: undefined, templateVersion: undefined, ...prepareApplication(input.template || 'empty', input.projectKey, settings)};
  const file = path.join(directory, '.' + input.projectKey + '.env');
  const stableData = input.data.split('\n').filter((line: string) => !line.startsWith('# created on ') && !line.startsWith('# BOOTSTRAPPER_REPOSITORY=') && line !== 'PROJECT_TEMPLATE="empty"').join('\n');
  const identity = [String(input.namespaceId), input.projectKey, stableData, input.ci];
  if (input.files) { identity.push(input.template, input.files); }
  const fingerprint = digest(JSON.stringify(identity));
  fs.mkdirSync(directory, {recursive: true});
  let receipt: any;
  if (fs.existsSync(file)) {
    receipt = readReceipt(fs.readFileSync(file, 'utf8'));
    if (!receipt || (receipt.fingerprint !== fingerprint && !(defaultProject && receipt.defaultProject && receipt.template === 'wizard'))) { throw new Error('Project Key already exists locally. Fetch before changing it.'); }
    if (receipt.state === 'complete') { return {id: receipt.operation, state: 'complete', repository: receipt.repository}; }
  } else {
    receipt = {operation: crypto.randomBytes(24).toString('hex'), fingerprint, namespaceId: input.namespaceId, template: input.template || 'empty', defaultProject, state: 'pending'};
    // Reserve the key before any asynchronous work; a second Save cannot win.
    fs.writeFileSync(file, input.data + '\n' + receiptLine + Buffer.from(JSON.stringify(receipt)).toString('base64') + '\n', {flag: 'wx', mode: 0o600});
  }
  const id = receipt.operation;
  if (jobs.get(id)?.state === 'running') { return jobs.get(id); }
  active.add(id);
  return startJob(id, async () => {
    try {
      const result = await rails({...input, action: 'create', operation: id});
      if (result.state === 'failed') {
        if (result.conflict && !receipt.repository) { fs.unlinkSync(file); }
        return result;
      }
      receipt.repository = result.repository;
      if (defaultProject) {
        receipt.repository.systemProject = true;
        receipt.repository.deploymentState = 'existing-interface';
        receipt.repository.generatedCi = input.ci;
      }
      // Persist identity before routing. Retry can repair routing without
      // recreating the project or overwriting a repository file.
      writeReceipt(file, input.data, receipt);
      await new Promise<void>((resolve, reject) => execFile('bash', ['apply.sh'],
        {cwd: path.resolve('../project-bootstrap'), timeout: 180000}, (error) => error ? reject(new Error('Repository ready; routing failed. Retry Save.')) : resolve()));
      if (input.files) {
        const pipeline = await rails({...input, files: undefined, action: 'pipeline', operation: id});
        if (pipeline.state === 'failed') { return pipeline; }
        receipt.repository.initialPipeline = pipeline.pipeline;
        receipt.repository.deploymentState = 'pipeline-started';
      }
      receipt.state = 'complete';
      writeReceipt(file, input.data, receipt);
      return {repository: receipt.repository, message: defaultProject ? 'System Wizard registered; the existing interface is unchanged.' : input.files ? 'Application and CI ready; first pipeline started.' : 'Repository and CI ready. Add application source to deploy.'};
    } finally { active.delete(id); }
  });
}
