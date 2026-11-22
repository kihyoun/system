import { PromotionService } from './promotion.service';
import { RecoveryOperationService } from './recoveryOperation.service';
import { PublicGitlabPrerequisiteService } from './publicGitlabPrerequisite.service';
import { GitlabDataSampleService } from '../gitlab-preflight/gitlabDataSample.service';
import { PublicUpgradeService } from './publicUpgrade.service';
import { PublicUpgradeBackupService } from './publicUpgradeBackup.service';
import { ReleaseSelectionService } from './releaseSelection.service';
import { PairedRuntimeService } from './pairedRuntime.service';
import { PairedUpdateService } from './pairedUpdate.service';
import { PairedControllerService } from './pairedController.service';
import { RecoveryExportService } from './recoveryExport.service';
import { RecoveryArchiveService } from './recoveryArchive.service';
import { DockerArchiveProcess } from '../../common/runtime/archiveProcess';
import { PublicReleaseAssetsService } from './publicReleaseAssets.service';
import {
  PublicUpgradePreparationService,
  type PublicHostFacts,
} from './publicUpgradePreparation.service';
import { ControllerLeaseModule } from './controllerLease.module';
import { GitlabPreflightModule } from '../gitlab-preflight/gitlabPreflight.module';
import { GitlabPreflightService } from '../gitlab-preflight/gitlabPreflight.service';
import { CandidateAuthorityService } from './candidateAuthority.service';
import { CandidateGitLabService } from './candidateGitlab.service';
import { PromotionRecoveryService } from './promotionRecovery.service';
import {
  PromotionNativePortService,
  type PromotionGitLabProbe,
} from './promotionNativePort.service';
import { ControllerCheckpointService } from './controllerCheckpoint.service';
import { RuntimeVerificationService } from '../host-bootstrap/runtimeVerification.service';
import { ControllerLeaseService } from './controllerLease.service';
import { PromotionAbortService, type PromotionAbortPort } from './promotionAbort.service';
import { PublicUpgradePlanService, type PublicUpgradePlanPort } from './publicUpgradePlan.service';
import {
  PublicUpgradeApplyService,
  type PublicUpgradeApplyPort,
} from './publicUpgradeApply.service';
import {
  ControllerRollbackSequenceService,
  type ControllerRollbackPort,
} from './controllerRollbackSequence.service';
import {
  ControllerUpdateSequenceService,
  type ControllerUpdateSequencePort,
} from './controllerUpdateSequence.service';
import { PromotionSequenceService, type PromotionSequencePort } from './promotionSequence.service';
import { ColdMaintenanceService, type ColdMaintenancePort } from './coldMaintenance.service';
import { RecoveryPublicationService } from './recoveryPublication.service';
import { UpgradeLifecycleService } from './upgradeLifecycle.service';
import { NativeHostAttachedProcess, type HostAttachedProcess } from './attachedProcess';
import type { LifecycleEvidencePort } from '../release/types';
import { HostReleaseAuthorityService } from './releaseAuthority.service';
import { Module, type DynamicModule } from '@nestjs/common';
import { nativeProcess, type ProcessRunner } from '../../common/runtime/process';
import { HostInstallService } from './install';
import { UpgradePrerequisiteService } from './upgradePrerequisite.service';
import { HostStorageService } from './hostStorage.service';
import { HostSourceService } from './source';
import { RecoveryImageService } from './recoveryImages';
import { RecoveryManifestService } from './recoveryManifest';
import { RuntimeInspectionService } from './runtimeInspection';
export const hostPublicUpgradeApplyPort = Symbol('HOST_PUBLIC_UPGRADE_APPLY_PORT');
export const hostControllerRollbackPort = Symbol('HOST_CONTROLLER_ROLLBACK_PORT');
export const hostControllerUpdateSequencePort = Symbol('HOST_CONTROLLER_UPDATE_SEQUENCE_PORT');
export const hostPromotionAbortPort = Symbol('HOST_PROMOTION_ABORT_PORT');
export const hostPromotionSequencePort = Symbol('HOST_PROMOTION_SEQUENCE_PORT');
export const hostColdMaintenancePort = Symbol('HOST_COLD_MAINTENANCE_PORT');
export const hostAttachedProcess = Symbol('HOST_ATTACHED_PROCESS');
export const hostProcessRunner = Symbol('HOST_PROCESS_RUNNER');
export const hostLifecycleEvidence = Symbol('HOST_LIFECYCLE_EVIDENCE');
export const hostEnvironment = Symbol('HOST_ENVIRONMENT');
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
          provide: PromotionService,
          inject: [
            HostInstallService,
            RuntimeVerificationService,
            CandidateAuthorityService,
            CandidateGitLabService,
            HostReleaseAuthorityService,
            HostSourceService,
            RecoveryImageService,
            RecoveryManifestService,
            RuntimeInspectionService,
            ControllerLeaseService,
            ControllerCheckpointService,
            PromotionNativePortService,
            PromotionRecoveryService,
            PromotionSequenceService,
            ColdMaintenanceService,
            PairedRuntimeService,
            PublicUpgradePreparationService,
          ],
          useFactory: (...dependencies: ConstructorParameters<typeof PromotionService>) =>
            new PromotionService(...dependencies),
        },
        {
          provide: PublicGitlabPrerequisiteService,
          inject: [
            HostInstallService,
            RuntimeVerificationService,
            PublicUpgradePreparationService,
            HostReleaseAuthorityService,
            RuntimeInspectionService,
            HostSourceService,
          ],
          useFactory: (
            host: HostInstallService,
            runtime: RuntimeVerificationService,
            preparation: PublicUpgradePreparationService,
            authority: HostReleaseAuthorityService,
            inspection: RuntimeInspectionService,
            source: HostSourceService,
          ) =>
            new PublicGitlabPrerequisiteService(
              host,
              runtime,
              preparation,
              authority,
              inspection,
              source,
            ),
        },
        {
          provide: RecoveryOperationService,
          inject: [RecoveryManifestService, RecoveryImageService],
          useFactory: (manifests: RecoveryManifestService, images: RecoveryImageService) =>
            new RecoveryOperationService(manifests, images),
        },
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
          provide: hostPublicUpgradeApplyPort,
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
          inject: [UpgradeLifecycleService, hostPublicUpgradeApplyPort],
          useFactory: (lifecycle: UpgradeLifecycleService, port: PublicUpgradeApplyPort) =>
            new PublicUpgradeApplyService(lifecycle, port),
        },
        {
          provide: hostControllerRollbackPort,
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
          inject: [hostControllerRollbackPort],
          useFactory: (port: ControllerRollbackPort) => new ControllerRollbackSequenceService(port),
        },
        {
          provide: hostControllerUpdateSequencePort,
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
          inject: [hostControllerUpdateSequencePort],
          useFactory: (port: ControllerUpdateSequencePort) =>
            new ControllerUpdateSequenceService(port),
        },
        {
          provide: hostPromotionAbortPort,
          inject: [PromotionNativePortService],
          useFactory: (native: PromotionNativePortService) => options.promotionAbortPort ?? native,
        },
        {
          provide: PromotionAbortService,
          inject: [hostPromotionAbortPort, ColdMaintenanceService],
          useFactory: (port: PromotionAbortPort, cold: ColdMaintenanceService) =>
            new PromotionAbortService(port, cold),
        },
        {
          provide: hostPromotionSequencePort,
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
          inject: [hostPromotionSequencePort],
          useFactory: (port: PromotionSequencePort) => new PromotionSequenceService(port),
        },
        {
          provide: hostColdMaintenancePort,
          inject: [PromotionNativePortService],
          useFactory: (native: PromotionNativePortService) => options.coldMaintenancePort ?? native,
        },
        {
          provide: ColdMaintenanceService,
          inject: [hostColdMaintenancePort],
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
          provide: hostAttachedProcess,
          useValue: options.attachedProcess ?? new NativeHostAttachedProcess(),
        },
        {
          provide: HostStorageService,
          inject: [HostInstallService, hostAttachedProcess],
          useFactory: (host: HostInstallService, attached: HostAttachedProcess) =>
            new HostStorageService(host, attached),
        },
        {
          provide: hostLifecycleEvidence,
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
          inject: [hostLifecycleEvidence],
          useFactory: (policy: LifecycleEvidencePort) => new HostReleaseAuthorityService(policy),
        },
        { provide: hostProcessRunner, useValue: options.runner ?? nativeProcess },
        { provide: hostEnvironment, useValue: options.environment ?? process.env },
        {
          provide: HostInstallService,
          inject: [hostProcessRunner, hostEnvironment],
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
        PromotionService,
        PublicGitlabPrerequisiteService,
        RecoveryOperationService,
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
        hostProcessRunner,
      ],
    };
  }
}
Module({})(HostModule);
