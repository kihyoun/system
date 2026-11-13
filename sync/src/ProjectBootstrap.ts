import {mainConfigPath, projectsDirectory} from './StatePaths';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import md5 from 'md5';
import {applicationTemplates, prepareApplication} from './ApplicationTemplates';
import {spawn, execFile} from 'child_process';

export const validProjectKey = (key: any) => typeof key === 'string' && /^[a-z0-9]+$/.test(key);
const directory = projectsDirectory();
const jobs = new Map<string, any>();
const active = new Set<string>();
export const projectBusy = () => active.size > 0;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const receiptLine = '# BOOTSTRAPPER_PROJECT=';
// Fetch carries this server-owned state back through the Wizard form.
const withoutReceipt = (data: string) => data.split('\n').filter(line => !line.startsWith(receiptLine)).join('\n');
const wizardAliases = require('../../nginx/wizard-aliases');

export function validateAliasProject(data: string, projectKey: string) {
  if (!fs.existsSync(mainConfigPath())) { return; }
  const projects = wizardAliases.projectFiles(directory).filter((file: {name: string}) => file.name !== '.' + projectKey + '.env');
  wizardAliases.validate(fs.readFileSync(mainConfigPath(), 'utf8'), [...projects.map((file: {content: string}) => file.content), data]);
}

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
  validateAliasProject(input.data, input.projectKey);
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
      'token-expiry-status': 'token-expiry/status.rb',
      ...Object.fromEntries(['preflight', 'project', 'revoke', 'read', 'read-many', 'source-context', 'system'].map(action => ['preview-setup-' + action, 'preview-setup/provision.rb'])),
      'wizard-build': 'wizard-build/activate.rb', 'wizard-build-status': 'wizard-build/activate.rb',
      'wizard-environments': 'wizard-environments/activate.rb', 'wizard-environments-status': 'wizard-environments/activate.rb',
      'wizard-source-primary-status': 'wizard-source-primary/status.rb',
      'wizard-environments-primary': 'wizard-environments/source-primary-activate.rb',
      'wizard-environments-primary-status': 'wizard-environments/source-primary-activate.rb'};
    const importer = modules[input.action] ? fs.readFileSync(path.join(__dirname, '../../project-bootstrap', modules[input.action]), 'utf8') + '\n' : '';
    const script = `BOOTSTRAPPER_INPUT = '${encoded}'\n` + importer + fs.readFileSync(path.join(__dirname, '../../project-bootstrap/provision.rb'), 'utf8');
    const child = spawn('docker', ['exec', '-i', 'system_gitlab_1', 'gitlab-rails', 'runner', '-']);
    let output = '', launched = false;
    const readOnly = ['namespaces', 'availability', 'wizard-build-status', 'wizard-environments-status',
      'wizard-source-primary-status', 'wizard-environments-primary-status', 'token-expiry-status',
      'preview-setup-preflight', 'preview-setup-read', 'preview-setup-read-many', 'preview-setup-source-context'].includes(input.action);
    const failure = (message: string) => Object.assign(new Error(message), {uncertain: launched && !readOnly, action: input.action});
    child.once('spawn', () => { launched = true; });
    const timer = setTimeout(() => {
      // Killing the local Docker client does not prove that the Rails process
      // inside GitLab ended. Callers must retain their mutation barriers.
      reject(failure('GitLab setup timed out; inspect the recorded operation before resuming.'));
      child.kill();
    }, 240000);
    child.stdout.on('data', (data) => {
      if (Buffer.byteLength(output) + Buffer.byteLength(data) > 2000000) {
        clearTimeout(timer); reject(failure('GitLab returned an oversized response; inspect the recorded operation.')); child.kill(); return;
      }
      output += data;
    });
    // Rails diagnostics can contain a temporary PAT. Never expose them.
    child.stderr.resume();
    child.on('error', () => { clearTimeout(timer); reject(failure('Could not access the local GitLab container.')); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { reject(failure('GitLab operation completion was not confirmed; inspect the recorded operation.')); return; }
      try {
        const result = JSON.parse(output.trim().split('\n').pop());
        if (!result || typeof result !== 'object' || Array.isArray(result) || !Object.keys(result).length) throw Error('terminal');
        resolve(result);
      } catch (_) { reject(failure('GitLab returned no complete terminal response; inspect the recorded operation.')); }
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
  fs.writeFileSync(temporary, withoutReceipt(data) + '\n' + receiptLine + Buffer.from(JSON.stringify(receipt)).toString('base64') + '\n', {mode: 0o600});
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
export function withProjectLock(id: string, operation: () => any, parentOperation?: string) {
  if (active.size > 0 && !(parentOperation && active.size === 1 && active.has(parentOperation))) { throw new Error('Another project operation is running. Retry after it completes.'); }
  active.add(id);
  try { return operation(); } catch (error) { active.delete(id); throw error; }
}
export function startJob(id: string, operation: () => Promise<any>) {
  trimJobs();
  const job: any = {id, state: 'running', created: Date.now()};
  jobs.set(id, job);
  operation().then((result) => Object.assign(job, result, {state: result.state || 'complete'}))
    .catch((error) => Object.assign(job, {state: 'failed', message: error.message, ...(error.uncertain === true ? {uncertain: true, uncertainAction: error.action} : {})}))
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
  input = {...input, data: withoutReceipt(input.data), resumeRepository: undefined, files: undefined, templateVersion: undefined,
    ...prepareApplication(input.template || 'empty', input.projectKey, settings)};
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
      const result = await rails({...input, action: 'create', operation: id, resumeRepository: receipt.repository});
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
