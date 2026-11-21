import { GitlabNativeContextService } from './native-context.service';
import { GitlabLockExecService } from './lock-exec.service';
import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { readPrivateInput } from '../host/private-input';
import type { LifecycleProcess } from '../../common/runtime/managed-child';
import { GitlabCredentialService, type GitlabCredentialOptions } from './credential.service';
import { GitlabAuthJournalService } from './auth-journal.service';
import { GitlabNativeApiService, GITLAB_PROVISION_PROCESS } from './native-api.service';
import { GitlabRunnerRequestService, type GitlabRunnerRequest } from './runner-request.service';
const description = 'System Bootstrapper Docker pool';
interface RunnerState {
  version: 1;
  nonce: string;
  runnerId?: number;
  token?: string;
  systemId?: string;
  rotation?: string;
  cleanup?: GitlabRunnerRequest;
  startup?: string;
  completedRequest?: GitlabRunnerRequest;
  managers?: { index: string; containerId: string; before: string; systemId: string }[];
  pending?: { route: string; body: Record<string, unknown>; request?: GitlabRunnerRequest };
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('gitlab-runner-response-invalid');
  return value as Record<string, unknown>;
}
function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}
function token(value: unknown): value is string {
  return typeof value === 'string' && /^glrt-[A-Za-z0-9_.-]+$/.test(value);
}
function validate(value: unknown): RunnerState {
  const state = row(value);
  if (
    state.version !== 1 ||
    typeof state.nonce !== 'string' ||
    !/^[a-f0-9]{48}$/.test(state.nonce) ||
    (state.runnerId !== undefined && !positive(state.runnerId)) ||
    (state.token !== undefined && !token(state.token))
  )
    throw Error('gitlab-runner-journal-invalid');
  if (
    (state.systemId !== undefined &&
      (typeof state.systemId !== 'string' || !/^[rs]_[A-Za-z0-9]+$/.test(state.systemId))) ||
    (state.rotation !== undefined &&
      (typeof state.rotation !== 'string' || !/^[a-f0-9]{48}$/.test(state.rotation)))
  )
    throw Error('gitlab-runner-journal-invalid');
  if (
    state.startup !== undefined &&
    (typeof state.startup !== 'string' || !/^(startup|staged)-[a-f0-9]{32}$/.test(state.startup))
  )
    throw Error('gitlab-runner-journal-invalid');
  if (state.managers !== undefined) {
    if (!Array.isArray(state.managers) || !state.rotation)
      throw Error('gitlab-runner-journal-invalid');
    for (const value of state.managers) {
      const manager = row(value);
      if (
        typeof manager.index !== 'string' ||
        !/^[1-9][0-9]*$/.test(manager.index) ||
        typeof manager.containerId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(manager.containerId) ||
        typeof manager.before !== 'string' ||
        !/^[a-f0-9]{64}$/.test(manager.before) ||
        typeof manager.systemId !== 'string' ||
        !/^[rs]_[A-Za-z0-9]+$/.test(manager.systemId)
      )
        throw Error('gitlab-runner-journal-invalid');
    }
  }
  if (state.pending !== undefined) {
    const pending = row(state.pending);
    if (
      typeof pending.route !== 'string' ||
      !/^(?:user\/runners|runners\/[1-9][0-9]*\/reset_authentication_token)$/.test(pending.route)
    )
      throw Error('gitlab-runner-journal-invalid');
    row(pending.body);
    if (
      pending.route !==
      (state.runnerId ? `runners/${state.runnerId}/reset_authentication_token` : 'user/runners')
    )
      throw Error('gitlab-runner-journal-invalid');
  }
  return state as unknown as RunnerState;
}
function policy(value: unknown): Record<string, unknown> {
  const runner = row(value);
  if (
    !positive(runner.id) ||
    runner.description !== description ||
    runner.runner_type !== 'instance_type' ||
    runner.locked !== false ||
    runner.run_untagged !== true ||
    runner.access_level !== 'not_protected' ||
    !Array.isArray(runner.tag_list) ||
    [...runner.tag_list].sort().join(',') !== 'aws,docker'
  )
    throw Error('gitlab-runner-policy-mismatch');
  return runner;
}
@Injectable()
export class GitlabRunnerCredentialService {
  constructor(
    private readonly credentials: GitlabCredentialService,
    private readonly journals: GitlabAuthJournalService,
    private readonly api: GitlabNativeApiService,
    private readonly requests: GitlabRunnerRequestService,
    @Inject(GITLAB_PROVISION_PROCESS) private readonly child: LifecycleProcess,
    private readonly contexts: GitlabNativeContextService,
    private readonly executions: GitlabLockExecService,
  ) {}

  async current(
    options: GitlabCredentialOptions & {
      persistentDirectory: string;
      rotateRunnerId?: number;
      rotation?: string;
      startupOperation?: string;
    },
  ) {
    if (
      !path.isAbsolute(options.persistentDirectory) ||
      (options.rotateRunnerId !== undefined && !positive(options.rotateRunnerId))
    )
      throw Error('gitlab-runner-input-invalid');
    if (
      Boolean(options.rotateRunnerId) !== Boolean(options.rotation) ||
      (options.rotation !== undefined && !/^[a-f0-9]{48}$/.test(options.rotation))
    )
      throw Error('gitlab-runner-rotation-operation-required');
    const authority = await this.credentials.ensure(options);
    const call = (method: 'GET' | 'POST', route: string, body?: Record<string, unknown>) =>
      this.api.request(authority.context, authority.credential.token, method, route, body);
    const details = async (id: number) => {
      const response = await call('GET', `runners/${id}`);
      if (response.status !== 200) throw Error('gitlab-runner-unavailable');
      const runner = policy(response.value);
      if (runner.id !== id) throw Error('gitlab-runner-identity-mismatch');
      return runner;
    };
    const verify = async (id: number, secret: string, systemId: string) => {
      const response = await call('POST', 'runners/verify', { token: secret, system_id: systemId });
      if (response.status !== 200 || row(response.value).id !== id)
        throw Error('gitlab-runner-token-verification-failed');
    };
    return this.journals.withFile(
      authority.configDirectory,
      'runner',
      validate,
      async (journal) => {
        let state = journal.read();
        if (!state) {
          const matches: number[] = [];
          for (let page = 1; ; page++) {
            if (page > 100) throw Error('gitlab-runner-inventory-limit');
            const response = await call(
              'GET',
              `runners/all?type=instance_type&per_page=100&page=${page}`,
            );
            if (response.status !== 200 || !Array.isArray(response.value))
              throw Error('gitlab-runner-inventory-unavailable');
            for (const item of response.value) {
              const runner = row(item);
              if (runner.description === description) {
                if (!positive(runner.id)) throw Error('gitlab-runner-identity-mismatch');
                matches.push(runner.id);
              }
            }
            if (response.value.length < 100) break;
          }
          if (matches.length > 1) throw Error('gitlab-runner-ownership-ambiguous');
          state = { version: 1, nonce: randomBytes(24).toString('hex'), runnerId: matches[0] };
          if (state.runnerId) await details(state.runnerId);
          if (options.rotateRunnerId !== undefined && options.rotateRunnerId !== state.runnerId)
            throw Error('gitlab-runner-rotation-identity-mismatch');
          journal.save(state);
        }
        if (options.rotateRunnerId !== undefined && options.rotateRunnerId !== state.runnerId)
          throw Error('gitlab-runner-rotation-identity-mismatch');
        if (state.runnerId) await details(state.runnerId);
        if (
          !state.pending &&
          state.runnerId &&
          !state.token &&
          options.rotateRunnerId === undefined
        ) {
          const recovered = (await this.ownedManagers(options, state.runnerId))[0];
          if (!recovered) throw Error('gitlab-runner-token-unavailable-explicit-rotation-required');
          await verify(state.runnerId, recovered.token, recovered.systemId);
          state.token = recovered.token;
          state.systemId = recovered.systemId;
          journal.save(state);
        }
        if (state.pending && options.rotation && state.rotation !== options.rotation)
          throw Error('gitlab-runner-pending-operation-mismatch');
        if (
          !state.pending &&
          (!state.runnerId ||
            (options.rotateRunnerId !== undefined && state.rotation !== options.rotation))
        ) {
          if (options.rotation) {
            const managers = await this.ownedManagers(options, state.runnerId!, true);
            state.rotation = options.rotation;
            state.managers = managers.map((manager) => ({
              index: manager.index,
              containerId: manager.containerId,
              before: createHash('sha256').update(manager.content).digest('hex'),
              systemId: manager.systemId,
            }));
            if (managers[0]) state.systemId = managers[0].systemId;
          }
          state.startup = options.startupOperation;
          state.pending = state.runnerId
            ? { route: `runners/${state.runnerId}/reset_authentication_token`, body: {} }
            : {
                route: 'user/runners',
                body: {
                  runner_type: 'instance_type',
                  description,
                  maintenance_note: 'System Bootstrapper runner: ' + state.nonce,
                  tag_list: ['docker', 'aws'],
                  run_untagged: true,
                  locked: false,
                  access_level: 'not_protected',
                },
              };
          journal.save(state);
        }
        if (state.pending) {
          if (state.startup !== options.startupOperation)
            throw Error('gitlab-runner-startup-reconciliation-required');
          try {
            const pending = state.pending;
            for (const manager of state.managers ?? []) {
              await this.child.run(
                'docker',
                [
                  '--host=unix:///var/run/docker.sock',
                  'stop',
                  '--timeout',
                  '30',
                  manager.containerId,
                ],
                {
                  cwd: options.checkout,
                  env: process.env,
                  signal: options.signal,
                  timeout: 60000,
                  maxBuffer: 4096,
                },
              );
            }
            const response = await this.requests.execute({
              containerId: authority.context.containerId,
              configDirectory: authority.configDirectory,
              token: authority.credential.token,
              route: pending.route,
              body: pending.body,
              pending: pending.request,
              signal: options.signal,
              save: (request) => {
                pending.request = request;
                journal.save(state!);
              },
            });
            if ([400, 401, 403, 404, 422].includes(response.status)) {
              state.cleanup = pending.request;
              delete state.pending;
              delete state.rotation;
              delete state.managers;
              journal.save(state);
              if (state.cleanup) {
                this.requests.cleanup(authority.configDirectory, state.cleanup);
                delete state.cleanup;
                journal.save(state);
              }
              throw Object.assign(Error('gitlab-runner-request-refused'), { uncertain: false });
            }
            if (![200, 201].includes(response.status))
              throw Error('gitlab-runner-request-refused-reconciliation-required');
            const result = row(response.value);
            const id = state.runnerId ?? result.id;
            if (
              !positive(id) ||
              (result.id !== undefined && result.id !== id) ||
              !token(result.token)
            )
              throw Error('gitlab-runner-credential-response-invalid');
            const runner = await details(id);
            if (
              !state.runnerId &&
              runner.maintenance_note !== 'System Bootstrapper runner: ' + state.nonce
            )
              throw Error('gitlab-runner-created-ownership-mismatch');
            if (state.systemId) await verify(id, result.token, state.systemId);
            state.runnerId = id;
            state.token = result.token;
            state.completedRequest = pending.request;
            state.cleanup = pending.request;
            delete state.pending;
            journal.save(state);
          } catch (error) {
            if (error instanceof Error && 'uncertain' in error && error.uncertain === false)
              throw error;
            throw Object.assign(Error('gitlab-runner-request-incomplete-reconciliation-required'), {
              uncertain: true,
            });
          }
        }

        if (state.managers && state.token) {
          for (const manager of state.managers) {
            const directory = path.join(
              options.persistentDirectory,
              'runners',
              'runner',
              manager.index,
              'config',
            );
            if (fs.realpathSync(directory) !== directory)
              throw Error('gitlab-runner-manager-directory-invalid');
            const filename = path.join(directory, 'config.toml');
            const content = readPrivateInput(filename, 65536, { owner: 0, mode: 0o600 }).toString(
              'utf8',
            );
            if ((content.match(/^\s*token = .+$/gm) ?? []).length !== 1)
              throw Error('gitlab-runner-manager-config-changed');
            const replacement = content.replace(
              /^(\s*token = ).+$/m,
              '$1' + JSON.stringify(state.token),
            );
            if (
              content !== replacement &&
              createHash('sha256').update(content).digest('hex') !== manager.before
            )
              throw Error('gitlab-runner-manager-config-changed');
            const systemId = readPrivateInput(path.join(directory, '.runner_system_id'), 256, {
              owner: 0,
            })
              .toString('utf8')
              .trim();
            if (systemId !== manager.systemId)
              throw Error('gitlab-runner-manager-system-id-changed');
            if (content !== replacement) {
              const temporary = path.join(directory, '.runner-token-' + state.rotation);
              if (fs.existsSync(temporary)) {
                readPrivateInput(temporary, 65536, { owner: 0, mode: 0o600 });
                fs.unlinkSync(temporary);
              }
              try {
                const fd = fs.openSync(temporary, 'wx', 0o600);
                try {
                  fs.writeFileSync(fd, replacement);
                  fs.fsyncSync(fd);
                } finally {
                  fs.closeSync(fd);
                }
                if (
                  readPrivateInput(filename, 65536, { owner: 0, mode: 0o600 }).toString('utf8') !==
                  content
                )
                  throw Error('gitlab-runner-manager-config-changed');
                fs.renameSync(temporary, filename);
                const fdDirectory = fs.openSync(
                  directory,
                  fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
                );
                try {
                  fs.fsyncSync(fdDirectory);
                } finally {
                  fs.closeSync(fdDirectory);
                }
              } finally {
                if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
              }
            }
          }
          delete state.managers;
          journal.save(state);
        }
        if (state.cleanup) {
          this.requests.cleanup(authority.configDirectory, state.cleanup);
          delete state.cleanup;
          journal.save(state);
        }
        if (!state.runnerId || !state.token) throw Error('gitlab-runner-credential-unavailable');
        if (state.systemId) await verify(state.runnerId, state.token, state.systemId);
        return { id: state.runnerId, token: state.token };
      },
    );
  }

  async reconciliation(
    options: GitlabCredentialOptions,
    startupOperation: string,
    rotation: string,
  ) {
    const directory = options.configDirectory ?? '/srv/gitlab/config';
    const context = await this.contexts.resolve(options.checkout, directory, options.signal);
    return this.journals.withFile(directory, 'runner', validate, async (journal) => {
      const state = journal.read();
      if (
        !state ||
        state.startup !== startupOperation ||
        (rotation === 'provision' ? !!state.rotation : state.rotation !== rotation)
      )
        throw Error('gitlab-runner-reconciliation-identity-mismatch');
      const request = state.pending?.request ?? state.completedRequest;
      if (!request?.exec || request.containerId !== context.containerId)
        throw Error('gitlab-runner-reconciliation-proof-missing');
      const proof = await this.executions.inspect(
        request.exec.id,
        context.containerId,
        request.exec.digest,
      );
      if (!proof || (!proof.running && proof.exitCode !== 0))
        throw Error('gitlab-runner-reconciliation-exec-incomplete');
      return { id: state.runnerId };
    });
  }

  private async ownedManagers(
    options: GitlabCredentialOptions & { persistentDirectory: string },
    runnerId: number,
    allowInvalidToken = false,
  ) {
    const result: {
      index: string;
      containerId: string;
      content: string;
      token: string;
      systemId: string;
    }[] = [];
    const root = path.join(options.persistentDirectory, 'runners', 'runner');
    if (!fs.existsSync(root)) return result;
    if (fs.realpathSync(root) !== root) throw Error('gitlab-runner-manager-directory-invalid');
    for (const index of fs
      .readdirSync(root)
      .filter((value) => /^[1-9][0-9]*$/.test(value))
      .sort()) {
      const directory = path.join(root, index, 'config');
      if (!fs.existsSync(path.join(directory, 'config.toml'))) continue;
      if (fs.realpathSync(directory) !== directory)
        throw Error('gitlab-runner-manager-directory-invalid');
      const inspected = row(
        JSON.parse(
          await this.child.run(
            'docker',
            [
              '--host=unix:///var/run/docker.sock',
              'inspect',
              '--format',
              '{{json .}}',
              'runner_docker_' + index,
            ],
            {
              cwd: options.checkout,
              env: process.env,
              signal: options.signal,
              timeout: 30000,
              maxBuffer: 2 * 1024 * 1024,
            },
          ),
        ),
      );
      const labels = row(row(inspected.Config).Labels);
      const mounts = Array.isArray(inspected.Mounts)
        ? inspected.Mounts.map(row).filter((m) => m.Destination === '/etc/gitlab-runner')
        : [];
      if (
        typeof inspected.Id !== 'string' ||
        !/^[a-f0-9]{64}$/.test(inspected.Id) ||
        inspected.Name !== '/runner_docker_' + index ||
        labels['com.docker.compose.project'] !== 'runner' ||
        labels['com.docker.compose.service'] !== 'docker_' + index ||
        mounts.length !== 1 ||
        mounts[0].Type !== 'bind' ||
        mounts[0].Source !== directory ||
        mounts[0].RW !== true
      )
        throw Error('gitlab-runner-manager-ownership-mismatch');
      const content = readPrivateInput(path.join(directory, 'config.toml'), 65536, {
        owner: 0,
        mode: 0o600,
      }).toString('utf8');
      if ((content.match(/^\s*\[\[runners\]\]\s*$/gm) ?? []).length !== 1)
        throw Error('gitlab-runner-manager-config-invalid');
      const field = (name: string) => {
        const matches = [...content.matchAll(new RegExp('^\\s*' + name + ' = (.+)$', 'gm'))];
        if (matches.length !== 1) throw Error('gitlab-runner-manager-config-invalid');
        try {
          return JSON.parse(matches[0][1]);
        } catch {
          throw Error('gitlab-runner-manager-config-invalid');
        }
      };
      if (
        field('id') !== runnerId ||
        field('name') !== 'runner-docker-' + index ||
        field('network_mode') !== 'system_gitlab'
      )
        throw Error('gitlab-runner-manager-identity-mismatch');
      const secret = field('token');
      if (typeof secret !== 'string' || (!allowInvalidToken && !token(secret)))
        throw Error('gitlab-runner-manager-token-invalid');
      const systemId = readPrivateInput(path.join(directory, '.runner_system_id'), 256, {
        owner: 0,
      })
        .toString('utf8')
        .trim();
      if (!/^[rs]_[A-Za-z0-9]+$/.test(systemId))
        throw Error('gitlab-runner-manager-system-id-invalid');
      result.push({ index, containerId: inspected.Id, content, token: secret, systemId });
    }
    return result;
  }
}
