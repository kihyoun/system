import { DynamicModule, Module } from '@nestjs/common';
import { UpgradeOptions } from './upgradeTypes';
import { Upgrade } from './upgradeSession';
import { UpgradeService } from './upgrade.service';
const upgradeOptions = Symbol('UPGRADE_OPTIONS');
@Module({})
export class UpgradeModule {
  static register(options: UpgradeOptions): DynamicModule {
    return {
      module: UpgradeModule,
      providers: [
        { provide: upgradeOptions, useValue: options },
        {
          provide: Upgrade,
          useFactory: (configuration: UpgradeOptions) => new Upgrade(configuration),
          inject: [upgradeOptions],
        },
        UpgradeService,
      ],
      exports: [UpgradeService],
    };
  }
}
