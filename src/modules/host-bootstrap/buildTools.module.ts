import { Module } from '@nestjs/common';
import { BuildToolsService } from './buildTools.service';
@Module({
  providers: [{ provide: BuildToolsService, useFactory: () => new BuildToolsService() }],
  exports: [BuildToolsService],
})
export class BuildToolsModule {}
