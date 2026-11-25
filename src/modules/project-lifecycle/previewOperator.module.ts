import { DynamicModule, Module } from '@nestjs/common';
import {
  previewSetupPort,
  PreviewSetupPort,
  PreviewOperatorService,
} from './previewOperator.service';
import { WizardEnvironmentsModule } from '../wizard-environments/wizardEnvironments.module';
import { EnvironmentPreflightService } from '../wizard-environments/environmentPreflight.service';
import * as nativeSetup from '../project-workflow/previewSetup';
@Module({})
export class PreviewOperatorModule {
  static register(setup?: PreviewSetupPort): DynamicModule {
    return {
      module: PreviewOperatorModule,
      imports: [WizardEnvironmentsModule],
      providers: [
        setup
          ? { provide: previewSetupPort, useValue: setup }
          : {
              provide: previewSetupPort,
              inject: [EnvironmentPreflightService],
              useFactory: (preflight: EnvironmentPreflightService): PreviewSetupPort => ({
                previewSetupStatus: nativeSetup.previewSetupStatus,
                preflightPreviewSetup: (input) =>
                  nativeSetup.preflightPreviewSetup(input, (settings) =>
                    preflight.validateSettings(settings),
                  ),
                applyPreviewSetup: (input) =>
                  nativeSetup.applyPreviewSetup(input, (settings) =>
                    preflight.validateSettings(settings),
                  ),
              }),
            },
        PreviewOperatorService,
      ],
      exports: [PreviewOperatorService],
    };
  }
}
