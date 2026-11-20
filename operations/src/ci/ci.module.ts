import { CodeqlService } from './codeql.service';
import { Module } from '@nestjs/common';
import { PlatformCheckService } from './platform.service';
@Module({
  providers: [
    { provide: CodeqlService, useFactory: () => new CodeqlService() },
    { provide: PlatformCheckService, useFactory: () => new PlatformCheckService() },
  ],
  exports: [PlatformCheckService, CodeqlService],
})
export class CiModule {}
