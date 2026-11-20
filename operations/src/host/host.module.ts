import { GitlabDataSampleService } from '../gitlab-preflight/gitlab-data-sample.service';
import { PublicUpgradeService } from './public-upgrade.service';
import { PublicUpgradeBackupService } from './public-upgrade-backup.service';
import { ReleaseSelectionService } from './release-selection.service';
import { PairedRuntimeService } from './paired-runtime.service';
import { PairedUpdateService } from './paired-update.service';
import { PairedControllerService } from './paired-controller.service';
import { RecoveryExportService } from './recovery-export.service';
import { RecoveryArchiveService } from './recovery-archive.service';
import { DockerArchiveProcess } from '../runtime/archive-process';
import { PublicReleaseAssetsService } from './public-release-assets.service';
import {
  PublicUpgradePreparationService,
  type PublicHostFacts,
} from './public-upgrade-preparation.service';
import { ControllerLeaseModule } from './controller-lease.module';
import { GitlabPreflightModule } from '../gitlab-preflight/gitlab-preflight.module';
import { GitlabPreflightService } from '../gitlab-preflight/gitlab-preflight.service';
import { CandidateAuthorityService } from './candidate-authority.service';
import { CandidateGitLabService } from './candidate-gitlab.service';
import { PromotionRecoveryService } from './promotion-recovery.service';
import {
  PromotionNativePortService,
  type PromotionGitLabProbe,
} from './promotion-native-port.service';
import { ControllerCheckpointService } from './controller-checkpoint.service';
import { RuntimeVerificationService } from '../host-bootstrap/runtime-verification.service';
import { ControllerLeaseService } from './controller-lease.service';
import { PromotionAbortService, type PromotionAbortPort } from './promotion-abort.service';
import {
  PublicUpgradePlanService,
  type PublicUpgradePlanPort,
} from './public-upgrade-plan.service';
import {
  PublicUpgradeApplyService,
  type PublicUpgradeApplyPort,
} from './public-upgrade-apply.service';
import {
  ControllerRollbackSequenceService,
  type ControllerRollbackPort,
} from './controller-rollback-sequence.service';
import {
  ControllerUpdateSequenceService,
  type ControllerUpdateSequencePort,
} from './controller-update-sequence.service';
import { PromotionSequenceService, type PromotionSequencePort } from './promotion-sequence.service';
import { ColdMaintenanceService, type ColdMaintenancePort } from './cold-maintenance.service';
import { RecoveryPublicationService } from './recovery-publication.service';
import { UpgradeLifecycleService } from './upgrade-lifecycle.service';
import { NativeHostAttachedProcess, type HostAttachedProcess } from './attached-process';
import type { LifecycleEvidencePort } from '../release/types';
import { HostReleaseAuthorityService } from './release-authority.service';
import { Module, type DynamicModule } from '@nestjs/common';
import { nativeProcess, type ProcessRunner } from '../runtime/process';
import { HostInstallService } from './install';
import { UpgradePrerequisiteService } from './upgrade-prerequisite.service';
import { HostStorageService } from './host-storage.service';
import { HostSourceService } from './source';
import { RecoveryImageService } from './recovery-images';
import { RecoveryManifestService } from './recovery-manifest';
import { RuntimeInspectionService } from './runtime-inspection';
export const HOST_PUBLIC_UPGRADE_APPLY_PORT = Symbol('HOST_PUBLIC_UPGRADE_APPLY_PORT');
export const HOST_CONTROLLER_ROLLBACK_PORT = Symbol('HOST_CONTROLLER_ROLLBACK_PORT');
export const HOST_CONTROLLER_UPDATE_SEQUENCE_PORT = Symbol('HOST_CONTROLLER_UPDATE_SEQUENCE_PORT');
export const HOST_PROMOTION_ABORT_PORT = Symbol('HOST_PROMOTION_ABORT_PORT');
export const HOST_PROMOTION_SEQUENCE_PORT = Symbol('HOST_PROMOTION_SEQUENCE_PORT');
export const HOST_COLD_MAINTENANCE_PORT = Symbol('HOST_COLD_MAINTENANCE_PORT');
export const HOST_ATTACHED_PROCESS = Symbol('HOST_ATTACHED_PROCESS');
export const HOST_PROCESS_RUNNER = Symbol('HOST_PROCESS_RUNNER');
export const HOST_LIFECYCLE_EVIDENCE = Symbol('HOST_LIFECYCLE_EVIDENCE');
export const HOST_ENVIRONMENT = Symbol('HOST_ENVIRONMENT');
export interface HostModuleOptions {
  candidateRequest?: typeof fetch;
  publicReleaseRequest?: typeof fetch;
  publicHostFacts?: PublicHostFacts;
  promotionGitLabProbe?: PromotionGitLabProbe;
  publicUpgradePlanPort?: PublicUpgradePlanPort;
  publicUpgradeApplyPort?: PublicUpgradeApplyPort;
  controllerRollbackPort?: ControllerRollbackPort;
  controllerUpdateSequencePort?: ControllerUpdateSequencePort;
  lifecycleEvidence?: LifecycleEvidencePort;
  promotionAbortPort?: PromotionAbortPort;
  promotionSequencePort?: PromotionSequencePort;
  coldMaintenancePort?: ColdMaintenancePort;
  runner?: ProcessRunner;
  attachedProcess?: HostAttachedProcess;
  environment?: NodeJS.ProcessEnv;
  initializationGuard?: () => () => void;
  rootUser?: () => boolean;
  deadline?: number;
}
/** Shared offline-capable services for HTTP and standalone CLI contexts. */
export class HostModule {
  static register(options: HostModuleOptions = {}): DynamicModule {
    const unavailable = () => {
      throw Error('host-lifecycle-evidence-policy-required');
    };
    const consumers = [
      UpgradePrerequisiteService,
      HostSourceService,
      RecoveryImageService,
      RecoveryManifestService,
      RuntimeInspectionService,
      RuntimeVerificationService,
    ];
    const nativePortRequired = () => {
      throw Error('cold-maintenance-native-port-required');
    };
    return {
      module: HostModule,
      imports: [GitlabPreflightModule, ControllerLeaseModule],
      providers: [
        {
          provide: PublicUpgradeBackupService,
          inject: [HostStorageService, RuntimeVerificationService],
          useFactory: (storage: HostStorageService, runtime: RuntimeVerificationService) =>
            new PublicUpgradeBackupService(storage, runtime),
        },
        {
          provide: PublicUpgradeService,
          inject: [
            HostInstallService,
            RuntimeVerificationService,
            PublicUpgradePreparationService,
            PublicUpgradeBackupService,
            PublicUpgradePlanService,
            PublicUpgradeApplyService,
            PairedControllerService,
            PairedUpdateService,
            PairedRuntimeService,
            UpgradePrerequisiteService,
            UpgradeLifecycleService,
            HostSourceService,
            RecoveryArchiveService,
            GitlabDataSampleService,
            CandidateGitLabService,
          ],
          useFactory: (
            host: HostInstallService,
            runtime: RuntimeVerificationService,
            preparation: PublicUpgradePreparationService,
            backup: PublicUpgradeBackupService,
            plans: PublicUpgradePlanService,
            applies: PublicUpgradeApplyService,
            controller: PairedControllerService,
            paired: PairedUpdateService,
            native: PairedRuntimeService,
            prerequisite: UpgradePrerequisiteService,
            lifecycle: UpgradeLifecycleService,
            source: HostSourceService,
            archives: RecoveryArchiveService,
            data: GitlabDataSampleService,
            gitlab: CandidateGitLabService,
          ) =>
            new PublicUpgradeService(
              host,
              runtime,
              preparation,
              backup,
              plans,
              applies,
              controller,
              paired,
              native,
              prerequisite,
              lifecycle,
              source,
              archives,
              data,
              gitlab,
            ),
        },

        { provide: ReleaseSelectionService, useFactory: () => new ReleaseSelectionService() },
        {
          provide: PairedRuntimeService,
          inject: [
            HostInstallService,
            RuntimeVerificationService,
            RuntimeInspectionService,
            ControllerLeaseService,
            GitlabPreflightService,
            PublicUpgradePreparationService,
          ],
          useFactory: (
            host: HostInstallService,
            runtime: RuntimeVerificationService,
            inspection: RuntimeInspectionService,
            lease: ControllerLeaseService,
            preflight: GitlabPreflightService,
            preparation: PublicUpgradePreparationService,
          ) => new PairedRuntimeService(host, runtime, inspection, lease, preflight, preparation),
        },
        {
          provide: PairedUpdateService,
          inject: [
            HostInstallService,
            HostSourceService,
            RuntimeVerificationService,
            PairedRuntimeService,
            ReleaseSelectionService,
            RecoveryImageService,
            PublicUpgradePreparationService,
            ControllerUpdateSequenceService,
            ControllerRollbackSequenceService,
          ],
          useFactory: (
            host: HostInstallService,
            source: HostSourceService,
            runtime: RuntimeVerificationService,
            native: PairedRuntimeService,
            selections: ReleaseSelectionService,
            images: RecoveryImageService,
            preparation: PublicUpgradePreparationService,
            updates: ControllerUpdateSequenceService,
            rollbacks: ControllerRollbackSequenceService,
          ) =>
            new PairedUpdateService(
              host,
              source,
              runtime,
              native,
              selections,
              images,
              preparation,
              updates,
              rollbacks,
            ),
        },
        {
          provide: PairedControllerService,
          inject: [
            HostInstallService,
            RuntimeVerificationService,
            HostReleaseAuthorityService,
            CandidateAuthorityService,
            CandidateGitLabService,
            PairedUpdateService,
          ],
          useFactory: (
            host: HostInstallService,
            runtime: RuntimeVerificationService,
            releases: HostReleaseAuthorityService,
            candidates: CandidateAuthorityService,
            gitlab: CandidateGitLabService,
            paired: PairedUpdateService,
          ) => new PairedControllerService(host, runtime, releases, candidates, gitlab, paired),
        },

        {
          provide: PublicReleaseAssetsService,
          useFactory: () => new PublicReleaseAssetsService(options.publicReleaseRequest),
        },
        {
          provide: PublicUpgradePreparationService,
          inject: [
            HostInstallService,
            RuntimeVerificationService,
            RuntimeInspectionService,
            HostSourceService,
            HostReleaseAuthorityService,
            PublicReleaseAssetsService,
          ],
          useFactory: (
            host: HostInstallService,
            runtime: RuntimeVerificationService,
            inspection: RuntimeInspectionService,
            source: HostSourceService,
            authority: HostReleaseAuthorityService,
            assets: PublicReleaseAssetsService,
          ) =>
            new PublicUpgradePreparationService(
              host,
              runtime,
              inspection,
              source,
              authority,
              assets,
              options.publicHostFacts,
            ),
        },
        {
          provide: CandidateGitLabService,
          useFactory: () => new CandidateGitLabService(options.candidateRequest),
        },
        {
          provide: CandidateAuthorityService,
          inject: [HostInstallService, HostReleaseAuthorityService],
          useFactory: (host: HostInstallService, releases: HostReleaseAuthorityService) =>
            new CandidateAuthorityService(host, releases),
        },
        {
          provide: PromotionNativePortService,
          inject: [
            HostInstallService,
            RuntimeVerificationService,
            ControllerLeaseService,
            ControllerCheckpointService,
            HostSourceService,
            RecoveryImageService,
            RuntimeInspectionService,
            GitlabPreflightService,
          ],
          useFactory: (
            host: HostInstallService,
            runtime: RuntimeVerificationService,
            lease: ControllerLeaseService,
            checkpoints: ControllerCheckpointService,
            source: HostSourceService,
            images: RecoveryImageService,
            inspection: RuntimeInspectionService,
            preflight: GitlabPreflightService,
          ) =>
            new PromotionNativePortService(
              host,
              runtime,
              lease,
              checkpoints,
              source,
              images,
              inspection,
              options.promotionGitLabProbe,
              preflight,
            ),
        },
        {
          provide: PromotionRecoveryService,
          inject: [PromotionNativePortService, PromotionAbortService],
          useFactory: (port: PromotionNativePortService, abort: PromotionAbortService) =>
            new PromotionRecoveryService(port, abort),
        },
        {
          provide: ControllerCheckpointService,
          inject: [ControllerLeaseService],
          useFactory: (lease: ControllerLeaseService) => new ControllerCheckpointService(lease),
        },
        {
          provide: PublicUpgradePlanService,
          useFactory: () =>
            new PublicUpgradePlanService(
              options.publicUpgradePlanPort ??
                (Object.fromEntries(
                  [
                    'publicInputs',
                    'verifyCheckout',
                    'installed',
                    'prerequisite',
                    'host',
                    'syncIdle',
                    'freeBytes',
                    'backupTarget',
                    'selection',
                    'capture',
                    'invoke',
                    'dataSample',
                    'now',
                  ].map((key) => [key, nativePortRequired]),
                ) as unknown as PublicUpgradePlanPort),
            ),
        },
        {
          provide: HOST_PUBLIC_UPGRADE_APPLY_PORT,
          useValue:
            options.publicUpgradeApplyPort ??
            Object.fromEntries(
              [
                'publicInputs',
                'prerequisite',
                'installed',
                'fingerprints',
                'assertBaseline',
                'dataSample',
                'host',
                'backupTarget',
                'invoke',
                'archive',
                'matchingBackup',
                'waitReady',
              ].map((key) => [key, nativePortRequired]),
            ),
        },
        {
          provide: PublicUpgradeApplyService,
          inject: [UpgradeLifecycleService, HOST_PUBLIC_UPGRADE_APPLY_PORT],
          useFactory: (lifecycle: UpgradeLifecycleService, port: PublicUpgradeApplyPort) =>
            new PublicUpgradeApplyService(lifecycle, port),
        },
        {
          provide: HOST_CONTROLLER_ROLLBACK_PORT,
          useValue:
            options.controllerRollbackPort ??
            Object.fromEntries(
              [
                'journal',
                'mainSha',
                'pairedBaseline',
                'verifySelection',
                'services',
                'stoppedIdle',
                'repairPeers',
                'critical',
                'command',
                'inspect',
                'writeConfiguration',
                'recoveredReceipt',
                'writeSelection',
                'reload',
                'restoreStopped',
                'waitReady',
                'inspectServices',
                'now',
                'verification',
              ].map((key) => [key, nativePortRequired]),
            ),
        },
        {
          provide: ControllerRollbackSequenceService,
          inject: [HOST_CONTROLLER_ROLLBACK_PORT],
          useFactory: (port: ControllerRollbackPort) => new ControllerRollbackSequenceService(port),
        },
        {
          provide: HOST_CONTROLLER_UPDATE_SEQUENCE_PORT,
          useValue:
            options.controllerUpdateSequencePort ??
            Object.fromEntries(
              [
                'journal',
                'assertBaseline',
                'verifySelection',
                'publicImages',
                'pipeline',
                'publicPair',
                'syncIdle',
                'currentServices',
                'repairBaseline',
                'critical',
                'command',
                'inspect',
                'writeConfiguration',
                'writeSelection',
                'now',
                'reload',
                'saveBaseline',
                'waitReady',
                'services',
                'saveVerification',
              ].map((key) => [key, nativePortRequired]),
            ),
        },
        {
          provide: ControllerUpdateSequenceService,
          inject: [HOST_CONTROLLER_UPDATE_SEQUENCE_PORT],
          useFactory: (port: ControllerUpdateSequencePort) =>
            new ControllerUpdateSequenceService(port),
        },
        {
          provide: HOST_PROMOTION_ABORT_PORT,
          inject: [PromotionNativePortService],
          useFactory: (native: PromotionNativePortService) => options.promotionAbortPort ?? native,
        },
        {
          provide: PromotionAbortService,
          inject: [HOST_PROMOTION_ABORT_PORT, ColdMaintenanceService],
          useFactory: (port: PromotionAbortPort, cold: ColdMaintenanceService) =>
            new PromotionAbortService(port, cold),
        },
        {
          provide: HOST_PROMOTION_SEQUENCE_PORT,
          useValue:
            options.promotionSequencePort ??
            Object.fromEntries(
              [
                'main',
                'sha',
                'inspect',
                'assertBaseline',
                'pipeline',
                'critical',
                'journal',
                'readJournal',
                'runners',
                'cold',
                'syncIdle',
                'command',
                'writeConfiguration',
                'reload',
                'waitStaged',
                'gitlabPreflight',
                'now',
              ].map((key) => [key, nativePortRequired]),
            ),
        },
        {
          provide: PromotionSequenceService,
          inject: [HOST_PROMOTION_SEQUENCE_PORT],
          useFactory: (port: PromotionSequencePort) => new PromotionSequenceService(port),
        },
        {
          provide: HOST_COLD_MAINTENANCE_PORT,
          inject: [PromotionNativePortService],
          useFactory: (native: PromotionNativePortService) => options.coldMaintenancePort ?? native,
        },
        {
          provide: ColdMaintenanceService,
          inject: [HOST_COLD_MAINTENANCE_PORT],
          useFactory: (port: ColdMaintenancePort) => new ColdMaintenanceService(port),
        },
        { provide: RecoveryPublicationService, useFactory: () => new RecoveryPublicationService() },
        {
          provide: RecoveryExportService,
          inject: [
            HostInstallService,
            HostSourceService,
            RecoveryManifestService,
            RecoveryImageService,
            RecoveryArchiveService,
            RecoveryPublicationService,
            RuntimeInspectionService,
            ControllerLeaseService,
            PublicUpgradePreparationService,
            RuntimeVerificationService,
            HostReleaseAuthorityService,
            CandidateAuthorityService,
            CandidateGitLabService,
          ],
          useFactory: (
            host: HostInstallService,
            source: HostSourceService,
            manifests: RecoveryManifestService,
            images: RecoveryImageService,
            archives: RecoveryArchiveService,
            publication: RecoveryPublicationService,
            inspection: RuntimeInspectionService,
            lease: ControllerLeaseService,
            preparation: PublicUpgradePreparationService,
            runtime: RuntimeVerificationService,
            authority: HostReleaseAuthorityService,
            candidate: CandidateAuthorityService,
            gitlab: CandidateGitLabService,
          ) =>
            new RecoveryExportService(
              host,
              source,
              manifests,
              images,
              archives,
              publication,
              inspection,
              lease,
              preparation,
              runtime,
              authority,
              candidate,
              gitlab,
            ),
        },
        {
          provide: RecoveryArchiveService,
          useFactory: () => new RecoveryArchiveService(new DockerArchiveProcess()),
        },
        { provide: UpgradeLifecycleService, useFactory: () => new UpgradeLifecycleService() },
        {
          provide: HOST_ATTACHED_PROCESS,
          useValue: options.attachedProcess ?? new NativeHostAttachedProcess(),
        },
        {
          provide: HostStorageService,
          inject: [HostInstallService, HOST_ATTACHED_PROCESS],
          useFactory: (host: HostInstallService, attached: HostAttachedProcess) =>
            new HostStorageService(host, attached),
        },
        {
          provide: HOST_LIFECYCLE_EVIDENCE,
          useValue: options.lifecycleEvidence ?? {
            stages: [],
            stagesV2: [],
            validateAuthority: unavailable,
            validate: unavailable,
            sanitize: unavailable,
          },
        },
        {
          provide: HostReleaseAuthorityService,
          inject: [HOST_LIFECYCLE_EVIDENCE],
          useFactory: (policy: LifecycleEvidencePort) => new HostReleaseAuthorityService(policy),
        },
        { provide: HOST_PROCESS_RUNNER, useValue: options.runner ?? nativeProcess },
        { provide: HOST_ENVIRONMENT, useValue: options.environment ?? process.env },
        {
          provide: HostInstallService,
          inject: [HOST_PROCESS_RUNNER, HOST_ENVIRONMENT],
          useFactory: (runner: ProcessRunner, environment: NodeJS.ProcessEnv) =>
            new HostInstallService(
              runner,
              environment,
              options.initializationGuard,
              options.rootUser,
              options.deadline,
            ),
        },
        ...consumers.map((service) => ({
          provide: service,
          inject: [HostInstallService],
          useFactory: (host: HostInstallService) => new service(host),
        })),
      ],
      exports: [
        PublicUpgradeService,
        PublicUpgradeBackupService,
        ReleaseSelectionService,
        PairedRuntimeService,
        PairedUpdateService,
        PairedControllerService,
        PublicReleaseAssetsService,
        PublicUpgradePreparationService,
        CandidateAuthorityService,
        CandidateGitLabService,
        PromotionRecoveryService,
        PromotionNativePortService,
        ControllerCheckpointService,
        ControllerLeaseModule,
        PromotionAbortService,
        PublicUpgradePlanService,
        PublicUpgradeApplyService,
        ControllerRollbackSequenceService,
        ControllerUpdateSequenceService,
        PromotionSequenceService,
        ColdMaintenanceService,
        RecoveryPublicationService,
        RecoveryArchiveService,
        RecoveryExportService,
        UpgradeLifecycleService,
        HostStorageService,
        HostReleaseAuthorityService,
        HostInstallService,
        ...consumers,
        HOST_PROCESS_RUNNER,
      ],
    };
  }
}
Module({})(HostModule);
