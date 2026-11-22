import { retainedCliArtifactSha256 } from '../project-lifecycle/buildRecipe.service';
import { Inject, Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import Helper from '../../common/configurationSignature';
import {
  environmentProject,
  environmentRecipes,
  EnvironmentProjectPort,
  EnvironmentRecipePort,
} from './ports';
import { EnvironmentStoreService } from './environmentStore.service';
import { defaults, hasDeployments } from './settings';
import {
  registryPrefix,
  validateManagedBinding,
  validateReservation,
  verifiedBuild,
  verifiedPrimaryBuild,
} from './contextPolicy';
import type {
  EnvironmentContext,
  EnvironmentPreview,
  EnvironmentRecipe,
  EnvironmentReservation,
} from './types';

export const digest = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

@Injectable()
export class EnvironmentContextService {
  constructor(
    private readonly store: EnvironmentStoreService,
    @Inject(environmentProject) private readonly project: EnvironmentProjectPort,
    @Inject(environmentRecipes) private readonly recipes: EnvironmentRecipePort,
  ) {}

  read(): EnvironmentContext {
    const snapshot = this.store.read(),
      { content, mainContent, receipt, platform } = snapshot;
    const primary = validateManagedBinding(receipt, this.project.wizardCi());

    if (!primary) {
      this.project.validateProject({
        projectKey: 'wizard',
        namespaceId: receipt.namespaceId,
        template: 'wizard',
        data: content,
        ci: this.project.wizardCi(),
      });
    }

    const current = receipt.wizardWorkflow.environments;
    const settings = this.store.settings(current?.settings || defaults(platform), platform);
    const settingsHash = digest(JSON.stringify(settings));
    validateReservation(current, settingsHash);
    const helperImage = this.store.inputs.helperImage(),
      controller = this.store.inputs.controller();
    const build = receipt.wizardWorkflow.build;
    const legacyRecipe = primary
      ? undefined
      : build
        ? this.recipes.select(
            Helper.textLogo,
            build.recipeHash,
            retainedCliArtifactSha256(build, receipt.sourcePrimary),
          )
        : this.recipes.forSource(Helper.textLogo, receipt.wizardWorkflow.sourceRevision);
    const registry = registryPrefix(platform, receipt.repository.path);

    if (current?.buildRecipeHash && current.buildRecipeHash !== build?.recipeHash) {
      throw new Error('The environment and build toolchain reservations differ.');
    }

    const initialVerified = primary
      ? verifiedPrimaryBuild(build) &&
        !!current &&
        this.recipes.primary(current).recipeHash === current.recipeHash &&
        same(current.ciFiles, receipt.sourcePrimary?.ciFiles)
      : verifiedBuild(build, legacyRecipe?.recipeHash, registry);
    const reasons: string[] = [];

    if (!current && !initialVerified) {
      reasons.push('Verify the Phase B candidate before enabling environments.');
    }

    if (primary && !initialVerified) {
      reasons.push(
        'Verify the adopted source-primary build and CI binding before configuring environments.',
      );
    }

    if (!/^sha256:[a-f0-9]{64}$/.test(helperImage)) {
      reasons.push('The operator must configure an immutable clean System helper image ID.');
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,126}$/.test(controller)) {
      reasons.push('The canonical System controller is not configured safely.');
    }

    if (current?.phase === 'requires-reconciliation') {
      reasons.push('Reconcile the recorded environment operation before another activation.');
    }

    const canUpdate = !!current && current.phase === 'ready' && !hasDeployments(current);

    if (hasDeployments(current)) {
      reasons.push(
        'Stop all active or pending Review and Beta deployments before changing settings.',
      );
    }

    return {
      ...snapshot,
      primary,
      current,
      settings,
      settingsHash,
      helperImage,
      controller,
      legacyRecipe,
      registryPrefix: registry,
      initialVerified,
      reasons,
      canUpdate,
      previewHash: digest(
        JSON.stringify({ version: 1, content, mainContent, helperImage, controller }),
      ),
    };
  }

  preview(): EnvironmentPreview {
    const value = this.read();
    return {
      version: 1,
      previewHash: value.previewHash,
      settingsHash: value.settingsHash,
      settings: value.settings,
      environments: value.current,
      repository: value.receipt.repository,
      capabilities: {
        canActivate:
          value.reasons.length === 0 && (!value.current || value.current.phase !== 'ready'),
        canUpdate: value.reasons.length === 0 && value.canUpdate,
        reasons: value.reasons,
        reviewLease: 'single-active-mr',
        manualJobsOnly: true,
        productionDeployment: false,
      },
      message:
        'Review uses one explicitly leased HTTPS host shared over time. Another merge request cannot overwrite its owner. Review and Beta deploy and stop only through manual GitLab jobs; Production is unchanged.',
    };
  }

  recipe(reservation: EnvironmentReservation): EnvironmentRecipe {
    if (reservation.managementMode === 'source-primary') {
      return this.recipes.primary(reservation);
    }

    return this.recipes.generate(Helper.textLogo, {
      settings: reservation.settings,
      settingsHash: reservation.settingsHash,
      helperImage: reservation.helperImage,
      operation: reservation.operation,
      controller: reservation.controller,
      buildRecipeHash: reservation.buildRecipeHash,
      cliArtifactSha256: reservation.cliArtifactSha256,
    });
  }

  reserve(
    value: EnvironmentContext,
    selected: EnvironmentContext['settings'],
    selectedHash: string,
  ): EnvironmentReservation {
    const updating = !!value.current && selectedHash !== value.current.settingsHash;

    if (value.current && !updating) {
      return {
        ...value.current,
        ...(value.legacyRecipe?.cliArtifactSha256
          ? { cliArtifactSha256: value.legacyRecipe.cliArtifactSha256 }
          : {}),
      };
    }

    const previous = value.current
      ? {
          ...value.current,
          ...(value.legacyRecipe?.cliArtifactSha256
            ? { cliArtifactSha256: value.legacyRecipe.cliArtifactSha256 }
            : {}),
        }
      : undefined;

    if (previous) {
      delete previous.previous;
    }

    if (value.primary) {
      if (!value.current?.activationCommit) {
        throw new Error(
          'The environment reservation changed. Inspect the server-owned receipt before continuing.',
        );
      }

      return {
        ...this.recipes.nextPrimary(
          { ...value.current, phase: 'ready', settings: selected, settingsHash: selectedHash },
          {
            operation: crypto.randomBytes(24).toString('hex'),
            helperImage: value.helperImage,
            activationCommit: value.current.activationCommit,
            ciFiles: value.current.ciFiles,
          },
        ),
        phase: 'pending',
        previous,
      };
    }

    return {
      version: 1,
      operation: crypto.randomBytes(24).toString('hex'),
      settings: selected,
      settingsHash: selectedHash,
      phase: 'pending',
      helperImage: value.helperImage,
      controller: value.controller,
      ...(value.legacyRecipe?.profile ? { buildRecipeHash: value.legacyRecipe.recipeHash } : {}),
      ...(value.legacyRecipe?.cliArtifactSha256
        ? { cliArtifactSha256: value.legacyRecipe.cliArtifactSha256 }
        : {}),
      ...(previous ? { previous, deployments: previous.deployments || {} } : {}),
    };
  }
}
