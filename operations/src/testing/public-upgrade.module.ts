import { Module } from '@nestjs/common';
import { PublicUpgradeTransportService } from './public-upgrade-transport.service';
import { PublicUpgradeRuntimeService } from './public-upgrade-runtime.service';
@Module({
  providers: [PublicUpgradeTransportService, PublicUpgradeRuntimeService],
  exports: [PublicUpgradeTransportService, PublicUpgradeRuntimeService],
})
export class PublicUpgradeFixtureModule {}
