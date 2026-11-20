import { GitlabDatabaseService } from './gitlab-database.service';
import { Module } from '@nestjs/common';
import { GitlabPreflightService } from './gitlab-preflight.service';
@Module({
  providers: [GitlabPreflightService, GitlabDatabaseService],
  exports: [GitlabPreflightService, GitlabDatabaseService],
})
export class GitlabPreflightModule {}
