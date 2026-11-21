import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Injectable } from '@nestjs/common';
import { ciFiles } from '../project-lifecycle/source-primary-environment';

type Row = Record<string, unknown>;
export interface GitlabActivationSession {
  request(
    method: 'GET' | 'POST' | 'PUT',
    route: string,
    body?: Row,
  ): Promise<{ status: number; value: unknown }>;
  /** Same database session and key as the historical adapter, held through callback completion. */
  withAdvisoryLock<T>(key: string, operation: () => Promise<T>): Promise<T>;
}
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid source-primary activation input');
  return value as Row;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw Error('Invalid source-primary activation input');
  return value;
}
function same(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}
const variables = [
  'SYSTEM_WIZARD_ENVIRONMENT_IMAGE',
  'SYSTEM_WIZARD_ENVIRONMENT_OPERATION',
  'WIZARD_REVIEW_HOST',
  'WIZARD_BETA_HOST',
] as const;
type Variable = (typeof variables)[number];
function values(environment: Row): Record<Variable, string> {
  const settings = row(environment.settings);
  const host = (kind: string) => {
    const setting = row(settings[kind]);
    if (typeof setting.enabled !== 'boolean') throw Error('Invalid environment enable setting');
    return setting.enabled ? text(setting.host) : '';
  };
  return {
    SYSTEM_WIZARD_ENVIRONMENT_IMAGE: text(environment.helperImage),
    SYSTEM_WIZARD_ENVIRONMENT_OPERATION: text(environment.operation),
    WIZARD_REVIEW_HOST: host('review'),
    WIZARD_BETA_HOST: host('beta'),
  };
}
/** Source/ownership verification and compare-before-write reconciliation, independent of credentials. */
@Injectable()
export class SourcePrimaryActivationService {
  validate(inputValue: unknown, projectValue: unknown): void {
    const input = row(inputValue),
      project = row(projectValue),
      environment = row(input.environments),
      repository = row(input.repository),
      binding = row(input.sourcePrimary);
    if (
      !['wizard-environments-primary', 'wizard-environments-primary-status'].includes(
        text(input.action),
      )
    )
      throw Error('Invalid source-primary activation action');
    if (
      repository.managementMode !== 'source-primary' ||
      !Number.isSafeInteger(project.id) ||
      Number(project.id) < 1 ||
      project.id !== repository.id ||
      project.path_with_namespace !== repository.path ||
      project.default_branch !== repository.defaultBranch ||
      row(project.namespace).id !== repository.namespaceId ||
      project.ci_config_path !== '.gitlab/primary.yml' ||
      project.visibility !== 'private' ||
      project.only_allow_merge_if_pipeline_succeeds !== true ||
      project.only_allow_merge_if_all_discussions_are_resolved !== true ||
      binding.version !== 1 ||
      environment.managementMode !== 'source-primary' ||
      environment.version !== 1 ||
      environment.activationCommit !== binding.adoptionCommit ||
      !same(environment.ciFiles, binding.ciFiles) ||
      !/^[a-f0-9]{48}$/.test(text(environment.operation)) ||
      !/^sha256:[a-f0-9]{64}$/.test(text(environment.helperImage)) ||
      environment.controller !== 'system_bootstrapper_1' ||
      input.controller !== 'system_bootstrapper_1'
    )
      throw Error('Source-primary Wizard repository ownership changed');
  }

  async activate(inputValue: unknown, projectValue: unknown, session: GitlabActivationSession) {
    this.validate(inputValue, projectValue);
    const input = row(inputValue),
      project = row(projectValue),
      environment = row(input.environments),
      binding = row(input.sourcePrimary);
    const prefix = `projects/${project.id}/`;
    const read = async (route: string, missing = false): Promise<unknown> => {
      const response = await session.request('GET', route);
      if (missing && response.status === 404) return null;
      if (response.status !== 200)
        throw Error('Source-primary environment lookup failed; refresh the same operation');
      return response.value;
    };
    const branch = row(
      await read(
        prefix + 'repository/branches/' + encodeURIComponent(text(project.default_branch)),
      ),
    );
    const sha = text(row(branch.commit).id);
    if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Source-primary branch identity invalid');
    for (const file of ciFiles(binding.ciFiles)) {
      const remote = row(
        await read(prefix + 'repository/files/' + encodeURIComponent(file.path) + '?ref=' + sha),
      );
      const encoded = text(remote.content).replace(/\n/g, '');
      const bytes = Buffer.from(encoded, 'base64');
      if (
        bytes.toString('base64') !== encoded ||
        crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256
      )
        throw Error('Source-primary CI changed; a reviewed adoption is required');
    }
    if (input.previousEnvironments !== undefined) {
      const previous = row(input.previousEnvironments);
      for (const slotValue of Object.values(row(previous.deployments ?? {}))) {
        const slot = row(slotValue);
        if (
          slot.active ||
          slot.pending ||
          !Array.isArray(slot.retired ?? []) ||
          (slot.retired as unknown[] | undefined)?.length
        )
          throw Error('Stop active and reconcile pending environments before settings updates');
      }
      if (
        previous.managementMode !== 'source-primary' ||
        !same(previous.ciFiles, environment.ciFiles) ||
        previous.activationCommit !== environment.activationCommit
      )
        throw Error('Source-primary previous reservation changed');
    }
    const key = BigInt(
      '0x' +
        crypto
          .createHash('sha256')
          .update(`system-wizard-environments:${project.id}`)
          .digest('hex')
          .slice(0, 15),
    ).toString();
    return session.withAdvisoryLock(key, async () => {
      const variable = async (name: Variable): Promise<string | null> => {
        const raw = await read(
          prefix + 'variables/' + name + '?filter%5Benvironment_scope%5D=*',
          true,
        );
        if (raw === null) return null;
        const value = row(raw);
        if (
          value.key !== name ||
          value.environment_scope !== '*' ||
          value.variable_type !== 'env_var' ||
          value.protected !== false ||
          value.masked !== false ||
          value.raw !== true ||
          value.hidden === true
        )
          throw Error('Source-primary environment variable ownership changed');
        return text(value.value);
      };
      const previous = row(input.previousEnvironments ?? environment),
        target = values(environment);
      const initial = binding.bootstrap === true && previous.initialVariablesMissing === true;
      const expected: Record<Variable, string | null> = initial
        ? (Object.fromEntries(variables.map((name) => [name, null])) as Record<Variable, null>)
        : values(previous);
      const result = (phase: string, message: string) => ({
        environments: { ...environment, phase },
        message,
      });
      const current = new Map<Variable, string | null>();
      for (const name of variables) current.set(name, await variable(name));
      if (
        variables.some(
          (name) => current.get(name) !== expected[name] && current.get(name) !== target[name],
        )
      )
        return result(
          'requires-reconciliation',
          'An environment variable has an unexpected value. Inspect the recorded reservation; nothing was overwritten.',
        );
      if (
        variables.some((name) => current.get(name) !== target[name]) &&
        input.action === 'wizard-environments-primary-status'
      )
        return result(
          'pending',
          'The recorded variable update is partially applied. Confirm the same settings to reconcile the exact operation.',
        );
      if (variables.some((name) => current.get(name) !== target[name]))
        for (const name of variables) {
          const actual = await variable(name);
          if (actual === target[name]) continue;
          if (actual !== expected[name])
            throw Error('Environment variable raced configuration; inspect the same operation');
          try {
            const response = await session.request(
              actual === null ? 'POST' : 'PUT',
              actual === null
                ? prefix + 'variables'
                : prefix + 'variables/' + name + '?filter%5Benvironment_scope%5D=*',
              {
                key: name,
                value: target[name],
                variable_type: 'env_var',
                protected: false,
                masked: false,
                raw: true,
                environment_scope: '*',
              },
            );
            if (![200, 201].includes(response.status)) throw Error();
          } catch {
            return result(
              'pending',
              'A variable update may have completed. Refresh the same reservation before retrying.',
            );
          }
        }
      for (const name of variables)
        if ((await variable(name)) !== target[name])
          throw Error(
            'Environment variables changed after synchronization; refresh the same operation',
          );
      return result(
        'ready',
        'Source-primary environment settings verified. Source code, pipelines and Production are unchanged.',
      );
    });
  }
}
