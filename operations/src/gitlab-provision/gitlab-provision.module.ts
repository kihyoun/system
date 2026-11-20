import { SourcePrimaryOperationService } from './source-primary-operation.service';
import { GitlabProjectCredentialService } from './project-credential.service';
import { GitlabNativeContextService } from './native-context.service';
import { GitlabCredentialService } from './credential.service';
import { GitlabPreflightModule } from '../gitlab-preflight/gitlab-preflight.module';
import { RecoveryRegistryCredentialService } from './recovery-registry-credential.service';
import { GitlabActivationSessionService } from './activation-session.service';
import {
  GitlabLockExecService,
  GitlabLockExecHttpTransport,
  GITLAB_LOCK_EXEC_HTTP,
} from './lock-exec.service';
import { GitlabControllerCredentialService } from './controller-credential.service';
import { GitlabAuthJournalService } from './auth-journal.service';
import { GitlabAuthBootstrapService } from './auth-bootstrap.service';
import { ManagedChildProcess } from '../runtime/managed-child';
import { GitlabNativeApiService, GITLAB_PROVISION_PROCESS } from './native-api.service';
import { Module } from '@nestjs/common';
import { SourcePrimaryActivationService } from './source-primary-activation.service';
@Module({
  imports: [GitlabPreflightModule],
  providers: [
    RecoveryRegistryCredentialService,
    SourcePrimaryOperationService,
    GitlabProjectCredentialService,
    GitlabNativeContextService,
    GitlabCredentialService,
    GitlabActivationSessionService,
    GitlabLockExecService,
    { provide: GITLAB_LOCK_EXEC_HTTP, useClass: GitlabLockExecHttpTransport },
    GitlabControllerCredentialService,
    GitlabAuthJournalService,
    GitlabAuthBootstrapService,
    SourcePrimaryActivationService,
    GitlabNativeApiService,
    { provide: GITLAB_PROVISION_PROCESS, useClass: ManagedChildProcess },
  ],
  exports: [
    RecoveryRegistryCredentialService,
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
