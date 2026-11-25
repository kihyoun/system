import { GitlabDataSampleService } from './gitlabDataSample.service';
import { GitlabDatabaseService } from './gitlabDatabase.service';
import { Module } from '@nestjs/common';
import { GitlabPreflightService } from './gitlabPreflight.service';
@Module({
  providers: [GitlabPreflightService, GitlabDatabaseService, GitlabDataSampleService],
  exports: [GitlabPreflightService, GitlabDatabaseService, GitlabDataSampleService],
})
export class GitlabPreflightModule {}
