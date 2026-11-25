import { Module } from '@nestjs/common';
import { PublicUpgradeTransportService } from './publicUpgradeTransport.service';
import { PublicUpgradeRuntimeService } from './publicUpgradeRuntime.service';
@Module({
  providers: [PublicUpgradeTransportService, PublicUpgradeRuntimeService],
  exports: [PublicUpgradeTransportService, PublicUpgradeRuntimeService],
})
export class PublicUpgradeFixtureModule {}
