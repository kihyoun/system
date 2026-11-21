import { Module } from '@nestjs/common';
import { RenovateVerificationService } from './verification.service';
import { RenovateSetupService } from './setup.service';
@Module({
  providers: [RenovateVerificationService, RenovateSetupService],
  exports: [RenovateVerificationService, RenovateSetupService],
})
export class RenovateModule {}
