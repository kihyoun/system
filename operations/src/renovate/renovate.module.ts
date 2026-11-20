import { Module } from '@nestjs/common';
import { RenovateVerificationService } from './verification.service';
@Module({ providers: [RenovateVerificationService], exports: [RenovateVerificationService] })
export class RenovateModule {}
