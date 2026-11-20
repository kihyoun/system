import { Module } from '@nestjs/common';
import { SourcePrimaryActivationService } from './source-primary-activation.service';
@Module({ providers: [SourcePrimaryActivationService], exports: [SourcePrimaryActivationService] })
export class GitlabProvisionModule {}
