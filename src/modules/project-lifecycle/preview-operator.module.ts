import { DynamicModule, Module } from '@nestjs/common';
import {
  PREVIEW_SETUP_PORT,
  PreviewSetupPort,
  PreviewOperatorService,
} from './preview-operator.service';
@Module({})
export class PreviewOperatorModule {
  static register(setup: PreviewSetupPort): DynamicModule {
    return {
      module: PreviewOperatorModule,
      providers: [{ provide: PREVIEW_SETUP_PORT, useValue: setup }, PreviewOperatorService],
      exports: [PreviewOperatorService],
    };
  }
}
