import { DynamicModule, Module } from '@nestjs/common';
import { UpgradeOptions } from './upgrade-types';
import { Upgrade } from './upgrade-session';
import { UpgradeService } from './upgrade.service';
const UPGRADE_OPTIONS = Symbol('UPGRADE_OPTIONS');
@Module({})
export class UpgradeModule {
  static register(options: UpgradeOptions): DynamicModule {
    return {
      module: UpgradeModule,
      providers: [
        { provide: UPGRADE_OPTIONS, useValue: options },
        {
          provide: Upgrade,
          useFactory: (configuration: UpgradeOptions) => new Upgrade(configuration),
          inject: [UPGRADE_OPTIONS],
        },
        UpgradeService,
      ],
      exports: [UpgradeService],
    };
  }
}
