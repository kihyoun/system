import { Module } from '@nestjs/common';
import { PackageAssetsService } from './packageAssets.service';
@Module({
  providers: [PackageAssetsService],
  exports: [PackageAssetsService],
})
export class BuildModule {}
