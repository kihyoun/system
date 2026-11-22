import { Inject, Injectable } from '@nestjs/common';
import { failureMessage, uncertainFailure } from '../../common/runtime/operationError';
import {
  environmentProject,
  environmentLease,
  EnvironmentProjectPort,
  EnvironmentOperationLeasePort,
  EnvironmentOperationLease,
} from './ports';
import { EnvironmentContextService, digest, same } from './environmentContext.service';
import { EnvironmentStoreService, EnvironmentWriteSession } from './environmentStore.service';
import { EnvironmentPreflightService } from './environmentPreflight.service';
import { object, validateRequestShape } from './settings';
import { readEnvironmentReservation } from './receipt';
import type {
  EnvironmentContext,
  EnvironmentExecution,
  EnvironmentJob,
  EnvironmentOutcome,
  EnvironmentPreview,
  EnvironmentReservation,
  NotActivated,
  Preparation,
} from './types';

@Injectable()
export class WizardEnvironmentWorkflowService {
  private preparing?: Preparation;

  constructor(
    private readonly context: EnvironmentContextService,
    private readonly store: EnvironmentStoreService,
    private readonly preflight: EnvironmentPreflightService,
    @Inject(environmentProject) private readonly project: EnvironmentProjectPort,
    @Inject(environmentLease) private readonly leases: EnvironmentOperationLeasePort,
  ) {}

  preview(): EnvironmentPreview {
    return this.context.preview();
  }

  inspect() {
    const operationLease = this.leases.observe();
    try {
      return { operationLease, preview: this.preview() };
    } catch (error) {
      return { operationLease, message: failureMessage(error) };
    }
  }

  configure(input: unknown, parentOperation?: string): EnvironmentJob {
    validateRequestShape(input);
    const value = this.context.read();
    const selected = this.store.settings(input.settings, value.platform);
    const selectedHash = digest(JSON.stringify(selected));
    const previous = this.running(value, selectedHash, input.previewHash);

    if (previous) {
      return previous;
    }

    this.confirm(value, input.previewHash, selectedHash);
    return this.start(this.execution('activate', value, selected, selectedHash), parentOperation);
  }

  refresh(): EnvironmentJob | NotActivated {
    const value = this.context.read();
    const previous = this.running(value);

    if (previous) {
      return previous;
    }

    if (!value.current) {
      return { state: 'not-activated', message: 'Review and Beta have not been configured.' };
    }

    return this.start(this.execution('status', value, value.settings, value.settingsHash));
  }

  private running(
    value: EnvironmentContext,
    selectedHash?: string,
    previewHash?: unknown,
  ): EnvironmentJob | undefined {
    const preparing = this.preparing,
      job = preparing && this.project.lookupJob(preparing.operation);

    if (preparing && job?.state === 'running') {
      if (
        selectedHash !== undefined &&
        (selectedHash !== preparing.settingsHash ||
          ![preparing.previewHash, value.previewHash].includes(
            typeof previewHash === 'string' ? previewHash : '',
          ))
      ) {
        throw new Error(
          'The active environment preparation has different settings or a stale preview.',
        );
      }

      return job;
    }

    const current = value.current,
      previous = current && this.project.lookupJob(current.operation);

    if (current && previous?.state === 'running') {
      if (selectedHash !== undefined && selectedHash !== current.settingsHash) {
        throw new Error('The active environment reservation has different settings.');
      }

      return previous;
    }

    return undefined;
  }

  private confirm(value: EnvironmentContext, previewHash: unknown, selectedHash: string): void {
    if (previewHash !== value.previewHash) {
      throw new Error('Fetch a fresh environment preview before confirmation.');
    }

    if (value.reasons.length) {
      throw new Error(value.reasons[0]);
    }

    if (value.current && selectedHash !== value.current.settingsHash && !value.canUpdate) {
      throw new Error(
        'Settings are immutable during a pending operation or deployment. Stop deployments and reconcile status before updating.',
      );
    }

    if (this.store.locked()) {
      throw new Error(
        'An environment helper owns the configuration lock. Wait for it to finish and refresh status.',
      );
    }
  }

  private execution(
    mode: 'activate' | 'status',
    value: EnvironmentContext,
    selected: EnvironmentContext['settings'],
    selectedHash: string,
  ): EnvironmentExecution {
    if (!value.primary && !value.legacyRecipe) {
      throw new Error('The reserved environment recipe changed. Use a reviewed recipe migration.');
    }

    const updating = !!value.current && selectedHash !== value.current.settingsHash;
    let reservation = this.context.reserve(value, selected, selectedHash);

    if (
      mode === 'activate' &&
      value.current &&
      !updating &&
      (reservation.helperImage !== value.helperImage || reservation.controller !== value.controller)
    ) {
      throw new Error(
        'The reserved helper identity changed. Restore it and reconcile before continuing.',
      );
    }

    const recipe = this.context.recipe(reservation);

    if (reservation.recipeHash && reservation.recipeHash !== recipe.recipeHash) {
      throw new Error('The reserved environment recipe changed. Use a reviewed recipe migration.');
    }

    reservation = { ...reservation, recipeHash: recipe.recipeHash };
    return { mode, context: value, selected, selectedHash, updating, reservation, recipe };
  }

  private start(execution: EnvironmentExecution, parentOperation?: string): EnvironmentJob {
    const { reservation, context, selectedHash, mode } = execution;
    return this.project.withProjectLock(
      reservation.operation,
      () => {
        const lease = this.leases.acquire(reservation.operation, reservation.helperImage);

        if (mode === 'activate') {
          this.preparing = {
            operation: reservation.operation,
            previewHash: context.previewHash,
            settingsHash: selectedHash,
          };
        }

        const session = this.store.session(context, reservation, execution.updating);
        let entered = false;
        try {
          return this.project.startJob(reservation.operation, () => {
            entered = true;
            return this.run(execution, session, lease);
          });
        } catch (error) {
          if (!entered) {
            if (this.preparing?.operation === reservation.operation) {
              this.preparing = undefined;
            }

            lease.finish(true);
          }

          throw error;
        }
      },
      parentOperation,
    );
  }

  private async validateAndReserve(
    execution: EnvironmentExecution,
    session: EnvironmentWriteSession,
  ): Promise<void> {
    await this.preflight.verify(execution.selected, execution.context.platform);

    if (this.context.read().previewHash !== execution.context.previewHash) {
      throw new Error(
        'Wizard configuration or receipt changed during local validation. Fetch a fresh preview before retrying.',
      );
    }

    // Durable external intent precedes every mutating GitLab request. An uncertain
    // remote result therefore retains the same reservation after process death.
    this.store.persist(session, { ...session.reservation, externalAttempted: true });
  }

  private request(execution: EnvironmentExecution, session: EnvironmentWriteSession) {
    const { context: value, mode, recipe } = execution,
      environments = session.reservation;
    const previousEnvironments = environments.previous;
    return this.project.call({
      action: value.primary
        ? mode === 'activate'
          ? 'wizard-environments-primary'
          : 'wizard-environments-primary-status'
        : mode === 'activate'
          ? 'wizard-environments'
          : 'wizard-environments-status',
      projectKey: 'wizard',
      namespaceId: session.receipt.namespaceId,
      operation: session.receipt.operation,
      repository: session.receipt.repository,
      workflow: session.receipt.wizardWorkflow,
      build: session.receipt.wizardWorkflow.build,
      environments,
      expectedCi: this.project.wizardCi(),
      legacyRecipe: value.legacyRecipe,
      recipe,
      previousEnvironments,
      previousRecipe: previousEnvironments ? this.context.recipe(previousEnvironments) : undefined,
      sourcePrimary: session.receipt.sourcePrimary,
      controller: environments.controller,
      registryPrefix: value.registryPrefix,
    });
  }

  private confirmedReply(
    execution: EnvironmentExecution,
    current: EnvironmentReservation,
    reply: unknown,
  ) {
    try {
      if (
        !object(reply) ||
        (reply.message !== undefined && typeof reply.message !== 'string') ||
        (reply.state !== undefined && typeof reply.state !== 'string') ||
        (reply.environments !== undefined && !object(reply.environments))
      ) {
        throw new Error('The environment operation returned a different reservation identity.');
      }

      // A mutating request needs a complete returned ownership confirmation.
      // Merging first would conceal omitted identity fields behind our request.
      const next =
        execution.mode === 'activate'
          ? { ...current, ...readEnvironmentReservation(reply.environments) }
          : readEnvironmentReservation({
              ...current,
              ...(object(reply.environments) ? reply.environments : {}),
            });

      if (
        next.version !== current.version ||
        next.operation !== current.operation ||
        next.settingsHash !== current.settingsHash ||
        next.recipeHash !== execution.recipe.recipeHash ||
        !same(next.settings, current.settings) ||
        next.helperImage !== current.helperImage ||
        next.controller !== current.controller ||
        next.managementMode !== current.managementMode ||
        next.buildRecipeHash !== current.buildRecipeHash ||
        next.cliArtifactSha256 !== current.cliArtifactSha256 ||
        !same(next.ciFiles, current.ciFiles) ||
        (current.activationCommit && next.activationCommit !== current.activationCommit)
      ) {
        throw new Error('The environment operation returned a different reservation identity.');
      }

      const installed =
        /^[a-f0-9]{40}$/.test(next.activationCommit || '') &&
        (!execution.context.primary || next.phase === 'ready');

      if (next.phase === 'ready' && !installed) {
        throw new Error('Environment readiness has no verified installation commit.');
      }

      if (
        execution.mode === 'activate' &&
        (next.phase === 'requires-reconciliation' ||
          (reply.state !== 'failed' &&
            (!installed || !['recipe-installed', 'ready'].includes(next.phase))))
      ) {
        throw new Error('Environment readiness has no verified installation commit.');
      }

      return {
        next,
        installed,
        failed: reply.state === 'failed',
        message: typeof reply.message === 'string' ? reply.message : undefined,
      };
    } catch (error) {
      if (execution.mode === 'activate') {
        throw Object.assign(error instanceof Error ? error : new Error(failureMessage(error)), {
          uncertain: true,
          action: execution.context.primary ? 'wizard-environments-primary' : 'wizard-environments',
        });
      }

      throw error;
    }
  }

  private verifiedReply(
    execution: EnvironmentExecution,
    current: EnvironmentReservation,
    reply: unknown,
  ) {
    const result = this.confirmedReply(execution, current, reply);

    if (result.failed) {
      throw new Error(result.message || 'Environment operation failed.');
    }

    const { next, installed } = result;

    if (
      execution.context.current?.phase === 'requires-reconciliation' &&
      !(installed && ['recipe-installed', 'ready'].includes(next.phase))
    ) {
      next.phase = 'requires-reconciliation';
    }

    if (installed && next.phase === 'recipe-installed') {
      next.phase = 'ready';
      next.message = '';
    }

    return {
      next,
      installed,
      message: result.message || 'Environment state verified. Production is unchanged.',
    };
  }

  private recordFailure(
    execution: EnvironmentExecution,
    session: EnvironmentWriteSession,
    error: unknown,
  ): never {
    const uncertain =
      uncertainFailure(error) ||
      session.reservation.phase === 'requires-reconciliation' ||
      execution.context.current?.phase === 'requires-reconciliation';
    try {
      this.store.persist(session, {
        ...session.reservation,
        phase: uncertain ? 'requires-reconciliation' : 'verification-failed',
        message: failureMessage(error),
      });
    } catch (writeError) {
      if (uncertain) {
        throw Object.assign(
          writeError instanceof Error ? writeError : new Error(failureMessage(writeError)),
          {
            uncertain: true,
            action: object(error) ? error.action : undefined,
          },
        );
      }

      throw writeError;
    }
    throw error;
  }

  private async run(
    execution: EnvironmentExecution,
    session: EnvironmentWriteSession,
    lease: EnvironmentOperationLease,
  ): Promise<EnvironmentOutcome> {
    let reserved = false;
    let safe = true;
    let failed = false;
    let failure: unknown;
    try {
      if (execution.mode === 'activate') {
        await this.validateAndReserve(execution, session);
        reserved = true;
      }

      const result = this.verifiedReply(
        execution,
        session.reservation,
        await this.request(execution, session),
      );
      const data = result.installed
        ? this.project.wizardConfiguration(execution.context.platform, result.next.settings)
        : undefined;
      this.store.persist(session, result.next, data);
      safe = session.reservation.phase !== 'requires-reconciliation';
      return { environments: session.reservation, message: result.message };
    } catch (error) {
      safe =
        !uncertainFailure(error) &&
        session.reservation.phase !== 'requires-reconciliation' &&
        execution.context.current?.phase !== 'requires-reconciliation';
      try {
        if (reserved || execution.mode === 'status') {
          this.recordFailure(execution, session, error);
        }

        throw error;
      } catch (outcome) {
        failed = true;
        failure = outcome;

        if (uncertainFailure(outcome)) {
          safe = false;
        }

        throw outcome;
      }
    } finally {
      if (this.preparing?.operation === session.reservation.operation) {
        this.preparing = undefined;
      }

      try {
        lease.finish(safe);
      } catch (error) {
        throw Object.assign(
          failed
            ? failure instanceof Error
              ? failure
              : new Error(failureMessage(failure))
            : error instanceof Error
              ? error
              : new Error(failureMessage(error)),
          { uncertain: true, ownershipFailure: failureMessage(error) },
        );
      }
    }
  }
}
