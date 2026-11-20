import { Module } from '@nestjs/common';
import { PlatformCheckService } from './platform.service';
@Module({
  providers: [{ provide: PlatformCheckService, useFactory: () => new PlatformCheckService() }],
  exports: [PlatformCheckService],
})
export class CiModule {}
