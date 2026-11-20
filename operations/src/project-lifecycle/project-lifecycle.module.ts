import { Module } from '@nestjs/common';
import { ProjectLifecycleService } from './project-lifecycle.service';
@Module({ providers: [ProjectLifecycleService], exports: [ProjectLifecycleService] })
export class ProjectLifecycleModule {}
