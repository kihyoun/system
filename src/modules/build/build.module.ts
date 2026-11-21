import { Module } from '@nestjs/common';
import { PackageAssetsService } from './package-assets.service';
import { ProjectCiBundleService } from './project-ci-bundle.service';
@Module({
  providers: [PackageAssetsService, ProjectCiBundleService],
  exports: [PackageAssetsService, ProjectCiBundleService],
})
export class BuildModule {}
