import { RuntimeVerificationService } from '../host-bootstrap/runtime-verification.service';
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
export const HOST_PROMOTION_SEQUENCE_PORT = Symbol('HOST_PROMOTION_SEQUENCE_PORT');
export const HOST_COLD_MAINTENANCE_PORT = Symbol('HOST_COLD_MAINTENANCE_PORT');
export const HOST_ATTACHED_PROCESS = Symbol('HOST_ATTACHED_PROCESS');
export const HOST_PROCESS_RUNNER = Symbol('HOST_PROCESS_RUNNER');
export const HOST_LIFECYCLE_EVIDENCE = Symbol('HOST_LIFECYCLE_EVIDENCE');
export const HOST_ENVIRONMENT = Symbol('HOST_ENVIRONMENT');
export interface HostModuleOptions {
  publicUpgradePlanPort?: PublicUpgradePlanPort;
  publicUpgradeApplyPort?: PublicUpgradeApplyPort;
  controllerRollbackPort?: ControllerRollbackPort;
  controllerUpdateSequencePort?: ControllerUpdateSequencePort;
  lifecycleEvidence?: LifecycleEvidencePort;
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
      providers: [
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
          useValue: options.coldMaintenancePort ?? {
            command: nativePortRequired,
            inspect: nativePortRequired,
            phase: nativePortRequired,
            probe: nativePortRequired,
            checkpoint: nativePortRequired,
            now: nativePortRequired,
            sleep: nativePortRequired,
            uptime: nativePortRequired,
            mainHash: nativePortRequired,
          },
        },
        {
          provide: ColdMaintenanceService,
          inject: [HOST_COLD_MAINTENANCE_PORT],
          useFactory: (port: ColdMaintenancePort) => new ColdMaintenanceService(port),
        },
        { provide: RecoveryPublicationService, useFactory: () => new RecoveryPublicationService() },
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
        PublicUpgradePlanService,
        PublicUpgradeApplyService,
        ControllerRollbackSequenceService,
        ControllerUpdateSequenceService,
        PromotionSequenceService,
        ColdMaintenanceService,
        RecoveryPublicationService,
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
