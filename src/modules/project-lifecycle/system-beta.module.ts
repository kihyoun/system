import { DynamicModule, Module } from '@nestjs/common';
import { BetaOptions } from './system-beta-session';
import { BETA_OPTIONS, SystemBetaService } from './system-beta.service';
@Module({})
export class SystemBetaModule {
  static register(options: BetaOptions = {}): DynamicModule {
    return {
      module: SystemBetaModule,
      providers: [{ provide: BETA_OPTIONS, useValue: options }, SystemBetaService],
      exports: [SystemBetaService],
    };
  }
}
