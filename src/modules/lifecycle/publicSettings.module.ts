import { Module } from '@nestjs/common';
import { WizardPublicSettingsService } from './publicSettings.service';

@Module({
  providers: [WizardPublicSettingsService],
  exports: [WizardPublicSettingsService],
})
export class WizardPublicSettingsModule {}
