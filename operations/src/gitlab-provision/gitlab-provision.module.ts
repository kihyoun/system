import { GitlabAuthJournalService } from './auth-journal.service';
import { GitlabAuthBootstrapService } from './auth-bootstrap.service';
import { ManagedChildProcess } from '../runtime/managed-child';
import { GitlabNativeApiService, GITLAB_PROVISION_PROCESS } from './native-api.service';
import { Module } from '@nestjs/common';
import { SourcePrimaryActivationService } from './source-primary-activation.service';
@Module({
  providers: [
    GitlabAuthJournalService,
    GitlabAuthBootstrapService,
    SourcePrimaryActivationService,
    GitlabNativeApiService,
    { provide: GITLAB_PROVISION_PROCESS, useClass: ManagedChildProcess },
  ],
  exports: [SourcePrimaryActivationService, GitlabNativeApiService, GitlabAuthBootstrapService],
})
export class GitlabProvisionModule {}
