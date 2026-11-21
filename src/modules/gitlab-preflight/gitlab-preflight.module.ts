import { GitlabDataSampleService } from './gitlab-data-sample.service';
import { GitlabDatabaseService } from './gitlab-database.service';
import { Module } from '@nestjs/common';
import { GitlabPreflightService } from './gitlab-preflight.service';
@Module({
  providers: [GitlabPreflightService, GitlabDatabaseService, GitlabDataSampleService],
  exports: [GitlabPreflightService, GitlabDatabaseService, GitlabDataSampleService],
})
export class GitlabPreflightModule {}
