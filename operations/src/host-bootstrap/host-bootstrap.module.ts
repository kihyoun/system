import { Module } from '@nestjs/common';
import { BuildToolsService } from './build-tools.service';
@Module({
  providers: [{ provide: BuildToolsService, useFactory: () => new BuildToolsService() }],
  exports: [BuildToolsService],
})
export class HostBootstrapModule {}
