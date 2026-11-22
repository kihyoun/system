import { recipeWriteProof, reconcileRecipeWrite, validateRecipeProof } from './recipeWriteProof';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import type { LifecycleProcess } from '../../common/runtime/managedChild';
import {
  GitlabDatabaseService,
  type GitlabDatabaseSession,
} from '../gitlab-preflight/gitlabDatabase.service';
import { GitlabAuthJournalService, type GitlabPrivateJournalSession } from './authJournal.service';
import {
  GitlabNativeApiService,
  gitlabProvisionProcess,
  type GitlabNativeContext,
} from './nativeApi.service';
import { GitlabLockExecService } from './lockExec.service';
import type { GitlabActivationSession } from './sourcePrimaryActivation.service';
type Row = Record<string, unknown>;
interface LockState {
  version: 1;
  projectId: number;
  key: string;
  operation: string;
  containerId: string;
  phase: 'idle' | 'creating' | 'starting' | 'held' | 'releasing';
  nonce: string;
  execId?: string;
  execDigest?: string;
  backend?: { pid: number; started: string };
  pending?: { method: 'POST' | 'PUT'; route: string; body: Row };
}
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('gitlab-activation-lock-invalid');
  }

  return value as Row;
}
function validate(value: unknown): LockState {
  const state = row(value);

  if (
    state.version !== 1 ||
    !Number.isSafeInteger(state.projectId) ||
    Number(state.projectId) < 1 ||
    typeof state.key !== 'string' ||
    !/^(?:0|[1-9][0-9]{0,18})$/.test(state.key) ||
    BigInt(state.key) > 9223372036854775807n ||
    typeof state.operation !== 'string' ||
    !/^[a-f0-9]{64}$/.test(state.operation) ||
    typeof state.containerId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(state.containerId) ||
    typeof state.nonce !== 'string' ||
    !/^[a-f0-9]{48}$/.test(state.nonce) ||
    !['idle', 'creating', 'starting', 'held', 'releasing'].includes(String(state.phase))
  ) {
    throw Error('gitlab-activation-lock-invalid');
  }

  if (
    state.execId !== undefined &&
    (typeof state.execId !== 'string' || !/^[a-f0-9]{64}$/.test(state.execId))
  ) {
    throw Error('gitlab-activation-lock-invalid');
  }

  if (
    state.execId !== undefined &&
    (typeof state.execDigest !== 'string' || !/^[a-f0-9]{64}$/.test(state.execDigest))
  ) {
    throw Error('gitlab-activation-lock-invalid');
  }

  if (state.backend !== undefined) {
    const backend = row(state.backend);

    if (
      !Number.isSafeInteger(backend.pid) ||
      Number(backend.pid) < 1 ||
      typeof backend.started !== 'string' ||
      !/^\d{1,16}\.\d{1,6}$/.test(backend.started)
    ) {
      throw Error('gitlab-activation-lock-invalid');
    }
  }

  if (state.pending !== undefined) {
    const pending = row(state.pending);

    if (
      !['POST', 'PUT'].includes(String(pending.method)) ||
      typeof pending.route !== 'string' ||
      !new RegExp(
        `^projects/${state.projectId}/(?:variables(?:/[A-Za-z0-9_]+)?|repository/commits|pipeline)$`,
      ).test(pending.route.split('?')[0])
    ) {
      throw Error('gitlab-activation-lock-invalid');
    }

    const body = row(pending.body);

    if (!pending.route.startsWith(`projects/${state.projectId}/variables`)) {
      validateRecipeProof(body);
    }

    if (Buffer.byteLength(JSON.stringify(pending)) > 16384) {
      throw Error('gitlab-activation-lock-invalid');
    }
  }

  return state as unknown as LockState;
}
/** The legacy PostgreSQL advisory key remains the operation barrier across controller exits. */
@Injectable()
export class GitlabActivationSessionService {
  constructor(
    private readonly journals: GitlabAuthJournalService,
    private readonly databases: GitlabDatabaseService,
    private readonly api: GitlabNativeApiService,
    private readonly execs: GitlabLockExecService,
    @Inject(gitlabProvisionProcess) private readonly child: LifecycleProcess,
  ) {}

  create(
    context: GitlabNativeContext,
    configDirectory: string,
    projectId: number,
    operation: string,
    token: string,
    purpose?: 'build' | 'environment',
  ): GitlabActivationSession {
    if (!Number.isSafeInteger(projectId) || projectId < 1 || !/^[a-f0-9]{64}$/.test(operation)) {
      throw Error('gitlab-activation-context-invalid');
    }

    let active:
      | {
          state: LockState;
          journal: GitlabPrivateJournalSession<LockState>;
          session: GitlabDatabaseSession;
        }
      | undefined;
    return {
      request: async (method, route, body) => {
        if (!route.startsWith(`projects/${projectId}/`)) {
          throw Error('gitlab-activation-project-route-required');
        }

        if (method === 'GET') {
          return this.api.request(context, token, method, route);
        }

        if (!active || active.state.phase !== 'held' || active.state.pending || !body) {
          throw Error('gitlab-activation-held-lock-required');
        }

        await this.assertBackend(active.session, active.state);
        const isRecipe =
          route === `projects/${projectId}/repository/commits` ||
          route === `projects/${projectId}/pipeline`;

        if (
          isRecipe &&
          (!purpose || method !== 'POST' || (route.endsWith('/pipeline') && purpose !== 'build'))
        ) {
          throw Error('gitlab-activation-write-route-invalid');
        }

        if (!isRecipe) {
          const allowed =
            /^(?:SYSTEM_WIZARD_ENVIRONMENT_(?:IMAGE|OPERATION)|WIZARD_(?:REVIEW|BETA)_HOST)$/.test(
              String(body.key),
            );
          const pipelineIntent =
            purpose === 'build' &&
            /^SYSTEM_WIZARD_PIPELINE_[a-f0-9]{48}$/.test(String(body.key)) &&
            method === 'POST';

          if (
            (!allowed && !pipelineIntent) ||
            ![
              `projects/${projectId}/variables`,
              `projects/${projectId}/variables/${body.key}`,
            ].includes(route.split('?')[0]) ||
            (route.includes('?') && !route.endsWith('?filter%5Benvironment_scope%5D=*'))
          ) {
            throw Error('gitlab-activation-write-route-invalid');
          }
        }

        const proof = isRecipe
          ? await recipeWriteProof(projectId, route, body, (target) =>
              this.api.request(context, token, 'GET', target),
            )
          : body;
        await this.assertBackend(active.session, active.state);
        active.state.pending = { method, route, body: proof };
        active.journal.save(active.state);
        const response = await this.api.request(context, token, method, route, body);

        if (response.status === 200 || response.status === 201) {
          await this.assertBackend(active.session, active.state);
          delete active.state.pending;
          active.journal.save(active.state);
        }

        return response;
      },
      withAdvisoryLock: async (key, callback) =>
        this.journals.withFile(
          configDirectory,
          purpose === 'build' ? `project-build-${projectId}` : `project-${projectId}`,
          validate,
          async (journal) => {
            let state = journal.read();

            if (
              state &&
              (state.projectId !== projectId ||
                (state.key !== key && !(purpose === 'build' && state.phase === 'idle')) ||
                (state.phase !== 'idle' &&
                  (state.operation !== operation || state.containerId !== context.containerId)))
            ) {
              throw Error('gitlab-activation-owned-operation-busy');
            }

            const session = await this.databases.open(context.containerId, {
              command: (args, seconds, input) =>
                this.child.run('docker', ['--host=unix:///var/run/docker.sock', ...args], {
                  cwd: context.checkout,
                  env: process.env,
                  input,
                  timeout: seconds * 1000,
                  maxBuffer: 2 * 1024 * 1024,
                }),
            });
            try {
              if (!state || state.phase === 'idle') {
                state = validate({
                  version: 1,
                  projectId,
                  key,
                  operation,
                  containerId: context.containerId,
                  phase: 'creating',
                  nonce: randomBytes(24).toString('hex'),
                });
                journal.save(state);
              }

              if (state.phase === 'creating') {
                const command = session.command(session.main, {
                  applicationName: 'sbp-' + state.nonce,
                });

                if (
                  command[0] !== 'exec' ||
                  command[1] !== '--user' ||
                  command[3] !== context.containerId
                ) {
                  throw Error('gitlab-activation-database-command-invalid');
                }

                const sql = `SET statement_timeout=0; SET idle_session_timeout=0; SELECT pg_sleep(2147483647) WHERE pg_try_advisory_lock(${key}::bigint);`;
                const execution = await this.execs.create(context.containerId, command[2], [
                  ...command.slice(4),
                  '--command',
                  sql,
                ]);
                state.execId = execution.id;
                state.execDigest = execution.digest;
                state.phase = 'starting';
                journal.save(state);
              }

              if (!state.execId) {
                throw Error('gitlab-activation-exec-proof-missing');
              }

              if (state.phase === 'starting') {
                await this.execs.start(state.execId, context.containerId, state.execDigest!);
                let backend: LockState['backend'];
                for (let attempt = 0; attempt < 20; attempt++) {
                  backend = await this.backend(session, state);

                  if (backend) {
                    break;
                  }

                  const execution = await this.execs.inspect(
                    state.execId,
                    context.containerId,
                    state.execDigest!,
                  );

                  if (!execution?.running) {
                    state.phase = 'idle';
                    journal.save(state);
                    throw Error('gitlab-activation-advisory-lock-busy');
                  }

                  await delay(100);
                }

                if (!backend) {
                  throw Error('gitlab-activation-acquisition-incomplete');
                }

                state.backend = backend;
                state.phase = 'held';
                journal.save(state);
              }

              const backend = await this.backend(session, state);

              if (!backend && !state.pending && ['held', 'releasing'].includes(state.phase)) {
                const execution = await this.execs.inspect(
                  state.execId,
                  context.containerId,
                  state.execDigest!,
                );

                if (execution?.running || state.pending) {
                  throw Error('gitlab-activation-release-incomplete');
                }

                state.phase = 'idle';
                delete state.backend;
                delete state.execId;
                delete state.execDigest;
                journal.save(state);
                throw Error('gitlab-activation-release-reconciled-retry');
              }

              if (!backend || !state.backend || !isDeepStrictEqual(backend, state.backend)) {
                throw Error('gitlab-activation-backend-ownership-lost');
              }

              if (state.phase === 'releasing') {
                await this.release(session, state, journal);
                throw Error('gitlab-activation-release-reconciled-retry');
              }

              if (state.pending) {
                if (
                  state.pending.body.kind === 'commit' ||
                  state.pending.body.kind === 'pipeline'
                ) {
                  if (!purpose || (state.pending.body.kind === 'pipeline' && purpose !== 'build')) {
                    throw Error('gitlab-activation-write-route-invalid');
                  }

                  const reconciled = await reconcileRecipeWrite(
                    projectId,
                    state.pending.body,
                    (route) => this.api.request(context, token, 'GET', route),
                  );
                  await this.assertBackend(session, state);

                  if (reconciled) {
                    delete state.pending;
                    journal.save(state);
                  }
                } else {
                  const pending = state.pending,
                    name = pending.body.key;

                  if (
                    typeof name !== 'string' ||
                    !/^(?:SYSTEM_WIZARD_ENVIRONMENT_(?:IMAGE|OPERATION)|SYSTEM_WIZARD_PIPELINE_[a-f0-9]{48}|WIZARD_(?:REVIEW|BETA)_HOST)$/.test(
                      name,
                    )
                  ) {
                    throw Error('gitlab-activation-pending-write-invalid');
                  }

                  const response = await this.api.request(
                    context,
                    token,
                    'GET',
                    `projects/${projectId}/variables/${name}?filter%5Benvironment_scope%5D=*`,
                  );
                  const current = row(response.value);

                  if (
                    response.status !== 200 ||
                    current.hidden === true ||
                    !Object.entries(pending.body).every(([key, value]) =>
                      isDeepStrictEqual(current[key], value),
                    )
                  ) {
                    throw Error('gitlab-activation-write-reconciliation-required');
                  }

                  await this.assertBackend(session, state);
                  delete state.pending;
                  journal.save(state);
                }
              }

              active = { state, journal, session };
              try {
                if (context.signal?.aborted) {
                  throw Error('gitlab-activation-cancelled');
                }

                return await callback();
              } finally {
                active = undefined;

                if (!state.pending) {
                  await this.release(session, state, journal);
                }
              }
            } finally {
              await session.close();
            }
          },
        ),
    };
  }

  private async assertBackend(session: GitlabDatabaseSession, state: LockState): Promise<void> {
    const backend = await this.backend(session, state);

    if (!backend || !state.backend || !isDeepStrictEqual(backend, state.backend)) {
      throw Error('gitlab-activation-backend-ownership-lost');
    }
  }

  private async backend(
    session: GitlabDatabaseSession,
    state: LockState,
  ): Promise<LockState['backend']> {
    const key = BigInt(state.key),
      high = (key >> 32n).toString(),
      low = (key & 4294967295n).toString();
    const result = await session.query(
      session.main,
      `SELECT COALESCE(json_agg(json_build_object('pid',a.pid,'started',EXTRACT(EPOCH FROM a.backend_start)::text)), '[]'::json) FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.application_name='sbp-${state.nonce}' AND a.usename=current_user AND a.datname=current_database() AND l.locktype='advisory' AND l.classid=${high}::oid AND l.objid=${low}::oid AND l.objsubid=1 AND l.granted`,
    );
    let values: unknown;
    try {
      values = JSON.parse(result.trim());
    } catch {
      throw Error('gitlab-activation-backend-proof-invalid');
    }

    if (!Array.isArray(values) || values.length > 1) {
      throw Error('gitlab-activation-backend-proof-invalid');
    }

    if (!values.length) {
      return undefined;
    }

    return validate({ ...state, backend: values[0] }).backend;
  }

  private async release(
    session: GitlabDatabaseSession,
    state: LockState,
    journal: GitlabPrivateJournalSession<LockState>,
  ): Promise<void> {
    if (state.pending || !state.backend) {
      throw Error('gitlab-activation-release-refused');
    }

    const backend = await this.backend(session, state);

    if (!backend || !isDeepStrictEqual(backend, state.backend)) {
      throw Error('gitlab-activation-release-ownership-lost');
    }

    state.phase = 'releasing';
    journal.save(state);
    const cancelled = await session.query(
      session.main,
      `SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE pid=${backend.pid} AND application_name='sbp-${state.nonce}' AND EXTRACT(EPOCH FROM backend_start)::text='${backend.started}' AND usename=current_user AND datname=current_database()`,
    );

    if (cancelled.trim() !== 't') {
      throw Error('gitlab-activation-release-incomplete');
    }

    for (let attempt = 0; attempt < 20; attempt++) {
      if (!(await this.backend(session, state))) {
        const execution = await this.execs.inspect(
          state.execId!,
          state.containerId,
          state.execDigest!,
        );

        if (!execution?.running) {
          state.phase = 'idle';
          delete state.backend;
          delete state.execId;
          delete state.execDigest;
          journal.save(state);
          return;
        }
      }

      await delay(100);
    }
    throw Error('gitlab-activation-release-incomplete');
  }
}
