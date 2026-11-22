import { DynamicModule, Module } from '@nestjs/common';
import { BetaOptions } from './systemBetaSession';
import { betaOptions, SystemBetaService } from './systemBeta.service';
@Module({})
export class SystemBetaModule {
  static register(options: BetaOptions = {}): DynamicModule {
    return {
      module: SystemBetaModule,
      providers: [{ provide: betaOptions, useValue: options }, SystemBetaService],
      exports: [SystemBetaService],
    };
  }
}
