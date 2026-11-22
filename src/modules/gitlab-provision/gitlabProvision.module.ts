import { ManagedBuildService } from './managedBuild.service';
import { ManagedEnvironmentService } from './managedEnvironment.service';
import { ManagedRecipeOperationService } from './managedRecipeOperation.service';
import {
  WizardSourceImportService,
  WizardSourcePrimaryStatusService,
  WizardSourceOperationService,
} from './wizardSource.service';
import { GitlabTokenMetadataService } from './tokenMetadata.service';
import { GitlabRunnerCredentialService } from './runnerCredential.service';
import { PreviewSetupService } from './previewSetup.service';
import { ProjectProvisionService } from './projectProvision.service';
import { GitlabRunnerRequestService } from './runnerRequest.service';
import { SourcePrimaryOperationService } from './sourcePrimaryOperation.service';
import { GitlabProjectCredentialService } from './projectCredential.service';
import { GitlabNativeContextService } from './nativeContext.service';
import { GitlabCredentialService } from './credential.service';
import { GitlabPreflightModule } from '../gitlab-preflight/gitlabPreflight.module';
import { RecoveryRegistryCredentialService } from './recoveryRegistryCredential.service';
import { GitlabActivationSessionService } from './activationSession.service';
import {
  GitlabLockExecService,
  GitlabLockExecHttpTransport,
  gitlabLockExecHttp,
} from './lockExec.service';
import { GitlabControllerCredentialService } from './controllerCredential.service';
import { GitlabAuthJournalService } from './authJournal.service';
import { GitlabAuthBootstrapService } from './authBootstrap.service';
import { ManagedChildProcess } from '../../common/runtime/managedChild';
import { GitlabNativeApiService, gitlabProvisionProcess } from './nativeApi.service';
import { Module } from '@nestjs/common';
import { SourcePrimaryActivationService } from './sourcePrimaryActivation.service';
@Module({
  imports: [GitlabPreflightModule],
  providers: [
    PreviewSetupService,
    ProjectProvisionService,
    RecoveryRegistryCredentialService,
    ManagedBuildService,
    ManagedEnvironmentService,
    ManagedRecipeOperationService,
    WizardSourceImportService,
    WizardSourcePrimaryStatusService,
    WizardSourceOperationService,
    GitlabTokenMetadataService,
    GitlabRunnerCredentialService,
    GitlabRunnerRequestService,
    SourcePrimaryOperationService,
    GitlabProjectCredentialService,
    GitlabNativeContextService,
    GitlabCredentialService,
    GitlabActivationSessionService,
    GitlabLockExecService,
    { provide: gitlabLockExecHttp, useClass: GitlabLockExecHttpTransport },
    GitlabControllerCredentialService,
    GitlabAuthJournalService,
    GitlabAuthBootstrapService,
    SourcePrimaryActivationService,
    GitlabNativeApiService,
    { provide: gitlabProvisionProcess, useClass: ManagedChildProcess },
  ],
  exports: [
    PreviewSetupService,
    ProjectProvisionService,
    RecoveryRegistryCredentialService,
    ManagedBuildService,
    ManagedEnvironmentService,
    ManagedRecipeOperationService,
    WizardSourceImportService,
    WizardSourcePrimaryStatusService,
    WizardSourceOperationService,
    GitlabTokenMetadataService,
    GitlabRunnerCredentialService,
    GitlabRunnerRequestService,
    SourcePrimaryOperationService,
    GitlabProjectCredentialService,
    GitlabCredentialService,
    GitlabActivationSessionService,
    SourcePrimaryActivationService,
    GitlabNativeApiService,
    GitlabAuthBootstrapService,
    GitlabControllerCredentialService,
  ],
})
export class GitlabProvisionModule {}
