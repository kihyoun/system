import { Module } from '@nestjs/common';
import { WizardPublicSettingsService } from './public-settings.service';

@Module({
  providers: [WizardPublicSettingsService],
  exports: [WizardPublicSettingsService],
})
export class WizardPublicSettingsModule {}
