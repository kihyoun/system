import { Module } from '@nestjs/common';
import { GitlabPreflightService } from './gitlab-preflight.service';
@Module({ providers: [GitlabPreflightService], exports: [GitlabPreflightService] })
export class GitlabPreflightModule {}
