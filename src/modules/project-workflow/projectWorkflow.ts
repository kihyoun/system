import { mainConfigPath, projectsDirectory } from '../configuration/statePaths';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { validConfigurationSignature } from '../../common/configurationValidation';
import { applicationTemplates, prepareApplication } from './applicationTemplates';
import { execFile } from 'child_process';
import type {
  NativeProjectRequest,
  NativeProjectResult,
  ProjectJob,
  ProjectJobEnvelope,
  ProjectReceipt,
} from './projectContracts';
import { inputRecord, projectCreationInput, validProjectKey } from './projectInputs';
import { readNativeProjectResult, readProjectReceipt } from './projectDecoders';
import { failureMessage, uncertainFailure } from '../../common/runtime/operationError';
export { validProjectKey } from './projectInputs';

const directory = projectsDirectory();
const jobs = new Map<string, ProjectJobEnvelope & { created: number }>();
const active = new Set<string>();
export const projectBusy = () => active.size > 0;
const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const receiptLine = '# BOOTSTRAPPER_PROJECT=';
// Fetch carries this server-owned state back through the Wizard form.
const withoutReceipt = (data: string) =>
  data
    .split('\n')
    .filter((line) => !line.startsWith(receiptLine))
    .join('\n');
import * as wizardAliases from '../projects-routing/wizardAliases';
import * as applicationAliases from '../projects-routing/applicationAliases';
import { checkoutRoot, cliArguments } from '../../common/runtime/installationPaths';

export function validateAliasProject(data: string, projectKey: string) {
  if (!fs.existsSync(mainConfigPath())) {
    return;
  }

  const projects = wizardAliases
    .projectFiles(directory)
    .filter((file: { name: string }) => file.name !== '.' + projectKey + '.env');
  const main = fs.readFileSync(mainConfigPath(), 'utf8');
  const contents = [...projects.map((file: { content: string }) => file.content), data];
  wizardAliases.validate(main, contents);
  applicationAliases.validate(main, contents, true);
}

export function validateProject(value: unknown) {
  const input = inputRecord(value);

  if (
    !input ||
    !validProjectKey(input.projectKey) ||
    !['string', 'number'].includes(typeof input.namespaceId) ||
    !/^[1-9][0-9]*$/.test(String(input.namespaceId))
  ) {
    throw new Error(
      'Project Key must contain only lowercase a-z and digits 0-9; select a namespace.',
    );
  }

  if (typeof input.data !== 'string' || !validConfigurationSignature(input.data)) {
    throw new Error('Invalid configuration signature.');
  }

  // These files are sourced by existing infrastructure scripts. Accept only
  // literal assignments from the established project generator, never shell code.
  const values: Record<string, string> = {};
  for (const line of input.data.substr(1184).split('\n')) {
    if (!line.trim() || line.startsWith('#')) {
      continue;
    }

    const match = /^(?:export )?([A-Z_]+)="([A-Za-z0-9_./:@+* -]*)"\s*$/.exec(line);

    if (
      !match ||
      !/^(PROJECT_NAME|PROJECT_TEMPLATE|USE_(PROD|BETA|REVIEW)_HOST|(PROD|BETA|REVIEW)_(HOST|DOMAIN_MODE|DEPLOY_MODE|SSL|SSL_KEY|ALIASES)|GITLAB_RUNNER_(TOKEN|SCALE))$/.test(
        match[1],
      )
    ) {
      throw new Error('Invalid project configuration assignment.');
    }

    if (values[match[1]] !== undefined) {
      throw new Error('Duplicate configuration assignment.');
    }

    values[match[1]] = match[2];
  }
  for (const environment of ['PROD', 'BETA', 'REVIEW']) {
    if (!['true', 'false'].includes(values['USE_' + environment + '_HOST'])) {
      throw new Error('Invalid environment enable setting.');
    }

    if (values['USE_' + environment + '_HOST'] === 'true') {
      const host = values[environment + '_HOST'] || '';

      if (
        host.length > 253 ||
        !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(
          host,
        )
      ) {
        throw new Error('Configure a valid ' + environment + ' host before Save.');
      }
    }

    for (const setting of ['DOMAIN_MODE', 'DEPLOY_MODE']) {
      const value = values[environment + '_' + setting];

      if (
        (value !== undefined || values['USE_' + environment + '_HOST'] === 'true') &&
        !(setting === 'DOMAIN_MODE' ? /^[0-3]$/ : /^[01]$/).test(value || '')
      ) {
        throw new Error('Invalid environment mode.');
      }
    }
  }

  if (values.PROJECT_NAME !== input.projectKey) {
    throw new Error('Project Key does not match configuration.');
  }

  const template = input.template || 'empty';

  if (typeof template !== 'string' || !applicationTemplates.includes(template)) {
    throw new Error('Select a supported application template.');
  }

  if (values.PROJECT_TEMPLATE !== undefined && values.PROJECT_TEMPLATE !== template) {
    throw new Error('Template does not match configuration.');
  }

  if (
    ['empty', 'wizard'].includes(template) &&
    (typeof input.ci !== 'string' ||
      input.ci.length > 200000 ||
      !input.ci.includes('CI_DEFAULT_BRANCH'))
  ) {
    throw new Error('Missing generated CI configuration.');
  }

  validateAliasProject(input.data, input.projectKey);
  return values;
}

let railsWorkers = 0;
const railsQueue: (() => void)[] = [];
export async function rails(input: NativeProjectRequest): Promise<NativeProjectResult> {
  if (railsQueue.length >= 50) {
    throw new Error('GitLab setup queue is busy. Retry shortly.');
  }

  if (railsWorkers >= 2) {
    await new Promise<void>((resolve) => railsQueue.push(resolve));
  }

  railsWorkers++;
  try {
    if (
      ['wizard-environments-primary', 'wizard-environments-primary-status'].includes(input.action)
    ) {
      return await runNativeActivation(input);
    }

    if (['namespaces', 'availability', 'create', 'pipeline'].includes(input.action)) {
      return await runNativeProject(input);
    }

    if (['wizard-source', 'wizard-source-primary-status'].includes(input.action)) {
      return await runNativeWizardSource(input);
    }

    if (
      [
        'wizard-build',
        'wizard-build-status',
        'wizard-environments',
        'wizard-environments-status',
      ].includes(input.action)
    ) {
      return await runNativeWizardSource(input, 'managed-recipe');
    }

    if (input.action === 'token-expiry-status') {
      return await runNativeTokenMetadata(input);
    }

    if (String(input.action).startsWith('preview-setup-')) {
      return await runNativeProject(input, 'preview');
    }

    throw new Error('Unsupported GitLab action.');
  } finally {
    railsWorkers--;
    const next = railsQueue.shift();

    if (next) {
      next();
    }
  }
}
function runNativeProject(
  input: NativeProjectRequest,
  command = 'project',
): Promise<NativeProjectResult> {
  return new Promise((resolve, reject) => {
    let launched = false;
    const failure = () =>
      Object.assign(
        new Error('GitLab operation completion was not confirmed; inspect the recorded operation.'),
        {
          uncertain:
            launched &&
            ['create', 'pipeline', 'preview-setup-project', 'preview-setup-revoke'].includes(
              input.action,
            ),
          action: input.action,
        },
      );
    const child = execFile(
      process.execPath,
      cliArguments('gitlab-provision', [command, '--checkout', checkoutRoot()]),
      { cwd: checkoutRoot(), timeout: 240000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(failure());
          return;
        }

        try {
          const decoded: unknown = JSON.parse(stdout);
          const result = inputRecord(decoded);

          if (!result || !Object.keys(result).length) {
            throw Error('terminal');
          }

          const { diagnostic: diagnosticValue, ...publicResult } = result;

          if (Object.hasOwn(result, 'diagnostic')) {
            const diagnostic = inputRecord(diagnosticValue);

            if (
              !diagnostic ||
              Object.keys(diagnostic).length !== 2 ||
              diagnostic.phase !== 'managed-ci-commit' ||
              typeof diagnostic.httpStatus !== 'number' ||
              !Number.isInteger(diagnostic.httpStatus) ||
              diagnostic.httpStatus < 100 ||
              diagnostic.httpStatus > 599 ||
              diagnostic.httpStatus === 201 ||
              result.state !== 'failed' ||
              result.message !== 'CI installation failed; retry Save'
            ) {
              throw Error('terminal');
            }

            console.log('BOOTSTRAPPER_PROJECT_CI_COMMIT_HTTP:' + diagnostic.httpStatus);
          }

          resolve(readNativeProjectResult(publicResult));
        } catch {
          reject(failure());
        }
      },
    );
    child.once('spawn', () => {
      launched = true;
    });

    if (!child.stdin) {
      child.kill();
      reject(new Error('GitLab operation input transport is unavailable.'));
      return;
    }

    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}
function runNativeActivation(input: NativeProjectRequest): Promise<NativeProjectResult> {
  return new Promise((resolve, reject) => {
    let launched = false;
    const child = execFile(
      process.execPath,
      cliArguments('gitlab-provision', ['activate', '--checkout', checkoutRoot()]),
      { cwd: checkoutRoot(), timeout: 240000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        const failure = () =>
          Object.assign(
            new Error(
              'GitLab activation completion was not confirmed; refresh the recorded operation.',
            ),
            {
              uncertain: launched && input.action === 'wizard-environments-primary',
              action: input.action,
            },
          );

        if (error) {
          reject(failure());
          return;
        }

        try {
          const decoded: unknown = JSON.parse(stdout);
          const result = inputRecord(decoded);

          if (!result || !inputRecord(result.environments)) {
            throw Error('Incomplete activation response');
          }

          resolve(readNativeProjectResult(result));
        } catch {
          reject(failure());
        }
      },
    );
    child.once('spawn', () => {
      launched = true;
    });

    if (!child.stdin) {
      child.kill();
      reject(new Error('GitLab operation input transport is unavailable.'));
      return;
    }

    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}
function runNativeTokenMetadata(input: NativeProjectRequest): Promise<NativeProjectResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      process.execPath,
      cliArguments('gitlab-provision', ['token-metadata', '--checkout', checkoutRoot()]),
      { cwd: checkoutRoot(), timeout: 240000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(new Error('GitLab token metadata is unavailable.'));
          return;
        }

        try {
          const decoded: unknown = JSON.parse(stdout);
          const value = inputRecord(decoded);

          if (!value || !Array.isArray(value.credentials)) {
            throw Error();
          }

          resolve(readNativeProjectResult(value));
        } catch {
          reject(new Error('GitLab token metadata is unavailable.'));
        }
      },
    );

    if (!child.stdin) {
      child.kill();
      reject(new Error('GitLab operation input transport is unavailable.'));
      return;
    }

    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}
function runNativeWizardSource(
  input: NativeProjectRequest,
  command = 'wizard-source',
): Promise<NativeProjectResult> {
  return new Promise((resolve, reject) => {
    let launched = false;
    const failure = () =>
      Object.assign(
        new Error('GitLab operation completion was not confirmed; inspect the recorded operation.'),
        {
          uncertain:
            launched &&
            ['wizard-source', 'wizard-build', 'wizard-environments'].includes(input.action),
          action: input.action,
        },
      );
    const child = execFile(
      process.execPath,
      cliArguments('gitlab-provision', [command, '--checkout', checkoutRoot()]),
      { cwd: checkoutRoot(), timeout: 240000, maxBuffer: 2 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(failure());
          return;
        }

        try {
          const value: unknown = JSON.parse(stdout);

          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw Error();
          }

          resolve(readNativeProjectResult(value));
        } catch {
          reject(failure());
        }
      },
    );
    child.once('spawn', () => {
      launched = true;
    });

    if (!child.stdin) {
      child.kill();
      reject(new Error('GitLab operation input transport is unavailable.'));
      return;
    }

    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(input));
  });
}

export function readReceipt(content: string): ProjectReceipt | undefined {
  const line = content.split('\n').find((item) => item.startsWith(receiptLine));
  return line
    ? readProjectReceipt(
        JSON.parse(Buffer.from(line.substr(receiptLine.length), 'base64').toString('utf8')),
      )
    : undefined;
}
export function writeReceipt(file: string, data: string, receipt: ProjectReceipt | undefined) {
  if (!receipt) {
    throw Error('Invalid stored project state.');
  }

  const temporary = file + '.tmp';
  fs.writeFileSync(
    temporary,
    withoutReceipt(data) +
      '\n' +
      receiptLine +
      Buffer.from(JSON.stringify(receipt)).toString('base64') +
      '\n',
    { mode: 0o600 },
  );
  fs.renameSync(temporary, file);
}
function trimJobs() {
  for (const [key, previous] of jobs) {
    if (previous.state !== 'running' && Date.now() - previous.created > 900000) {
      jobs.delete(key);
    }
  }
  while (jobs.size >= 200) {
    const completed = Array.from(jobs).find((entry) => entry[1].state !== 'running');

    if (!completed) {
      break;
    }

    jobs.delete(completed[0]);
  }
}
export function withProjectLock<T>(id: string, operation: () => T, parentOperation?: string): T {
  if (active.size > 0 && !(parentOperation && active.size === 1 && active.has(parentOperation))) {
    throw new Error('Another project operation is running. Retry after it completes.');
  }

  active.add(id);
  try {
    return operation();
  } catch (error) {
    active.delete(id);
    throw error;
  }
}
export function startJob<Result extends object>(
  id: string,
  operation: () => Promise<Result>,
): ProjectJob<Result> {
  trimJobs();
  const job: ProjectJobEnvelope & { created: number } = {
    id,
    state: 'running',
    created: Date.now(),
  };
  jobs.set(id, job);
  operation()
    .then((result) => {
      const values = inputRecord(result);

      if (
        !values ||
        (values.state !== undefined && typeof values.state !== 'string') ||
        (values.message !== undefined && typeof values.message !== 'string') ||
        (values.id !== undefined && values.id !== id)
      ) {
        throw Error('Invalid project operation result.');
      }

      for (const [key, value] of Object.entries(values)) {
        Object.defineProperty(job, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      job.state = typeof values.state === 'string' && values.state ? values.state : 'complete';
    })
    .catch((error) =>
      Object.assign(job, {
        state: 'failed',
        message: failureMessage(error),
        ...(uncertainFailure(error)
          ? {
              uncertain: true,
              uncertainAction:
                error && typeof error === 'object' && 'action' in error ? error.action : undefined,
            }
          : {}),
      }),
    )
    .finally(() => active.delete(id));
  // Results are absent while pending and added only after the envelope check above.
  return job as ProjectJob<Result>;
}
export function lookupJob(id: string) {
  return jobs.get(id);
}
export function queryGitlab(input: NativeProjectRequest): ProjectJob {
  trimJobs();

  if (jobs.size >= 200) {
    throw new Error('Too many pending operations. Retry shortly.');
  }

  const id = digest(JSON.stringify(input));
  const previous = jobs.get(id);

  if (previous && previous.state === 'running') {
    readNativeProjectResult(previous);
    return previous as ProjectJob;
  }

  return startJob(id, () => rails(input));
}
export function createProject(value: unknown, defaultProject = false): ProjectJob {
  if (inputRecord(value)?.template === 'wizard' && !defaultProject) {
    throw new Error('The system Wizard project is managed automatically.');
  }

  const settings = validateProject(value);
  const request = projectCreationInput(value);
  const input = {
    ...request,
    data: withoutReceipt(request.data),
    resumeRepository: undefined,
    files: undefined,
    templateVersion: undefined,
    ...prepareApplication(request.template || 'empty', request.projectKey, settings),
  };
  const file = path.join(directory, '.' + input.projectKey + '.env');
  const stableData = input.data
    .split('\n')
    .filter(
      (line: string) =>
        !line.startsWith('# created on ') &&
        !line.startsWith('# BOOTSTRAPPER_REPOSITORY=') &&
        line !== 'PROJECT_TEMPLATE="empty"',
    )
    .join('\n');
  const identity: unknown[] = [String(input.namespaceId), input.projectKey, stableData, input.ci];

  if (input.files) {
    identity.push(input.template, input.files);
  }

  const fingerprint = digest(JSON.stringify(identity));
  fs.mkdirSync(directory, { recursive: true });
  let receipt: ProjectReceipt;

  if (fs.existsSync(file)) {
    const storedReceipt = readReceipt(fs.readFileSync(file, 'utf8'));

    if (
      !storedReceipt ||
      (storedReceipt.fingerprint !== fingerprint &&
        !(defaultProject && storedReceipt.defaultProject && storedReceipt.template === 'wizard'))
    ) {
      throw new Error('Project Key already exists locally. Fetch before changing it.');
    }

    receipt = storedReceipt;

    if (receipt.state === 'complete') {
      if (typeof receipt.operation !== 'string' || !receipt.operation) {
        throw new Error('Project operation identity is missing. Fetch before retrying.');
      }

      return { id: receipt.operation, state: 'complete', repository: receipt.repository };
    }
  } else {
    receipt = {
      operation: crypto.randomBytes(24).toString('hex'),
      fingerprint,
      namespaceId: input.namespaceId,
      template: input.template || 'empty',
      defaultProject,
      state: 'pending',
    };
    // Reserve the key before any asynchronous work; a second Save cannot win.
    fs.writeFileSync(
      file,
      input.data +
        '\n' +
        receiptLine +
        Buffer.from(JSON.stringify(receipt)).toString('base64') +
        '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }

  const id = receipt.operation;

  if (typeof id !== 'string' || !id) {
    throw new Error('Project operation identity is missing. Fetch before retrying.');
  }

  const currentJob = jobs.get(id);

  if (currentJob?.state === 'running') {
    readNativeProjectResult(currentJob);
    return currentJob as ProjectJob;
  }

  active.add(id);
  return startJob(id, async () => {
    try {
      const result = await rails({
        ...input,
        action: 'create',
        operation: id,
        resumeRepository: receipt.repository,
      });

      if (result.state === 'failed') {
        if (result.conflict && !receipt.repository) {
          fs.unlinkSync(file);
        }

        return result;
      }

      if (!result.repository || typeof result.repository.id !== 'number') {
        throw new Error('GitLab operation returned no repository identity.');
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
      await new Promise<void>((resolve, reject) =>
        execFile(
          process.execPath,
          cliArguments('projects-routing', ['routing', 'apply', checkoutRoot(), '/templates']),
          { cwd: checkoutRoot(), timeout: 180000 },
          (error) =>
            error ? reject(new Error('Repository ready; routing failed. Retry Save.')) : resolve(),
        ),
      );

      if (input.files) {
        const pipeline = await rails({
          ...input,
          files: undefined,
          action: 'pipeline',
          operation: id,
        });

        if (pipeline.state === 'failed') {
          return pipeline;
        }

        receipt.repository.initialPipeline = pipeline.pipeline;
        receipt.repository.deploymentState = 'pipeline-started';
      }

      receipt.state = 'complete';
      writeReceipt(file, input.data, receipt);
      return {
        repository: receipt.repository,
        message: defaultProject
          ? 'System Wizard registered; the existing interface is unchanged.'
          : input.files
            ? 'Application and CI ready; first pipeline started.'
            : 'Repository and CI ready. Add application source to deploy.',
      };
    } finally {
      active.delete(id);
    }
  });
}
