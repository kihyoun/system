import { CodeqlParentService } from './codeql-parent.service';
import { CodeqlService } from './codeql.service';
import { Module } from '@nestjs/common';
import { PlatformCheckService } from './platform.service';
@Module({
  providers: [
    { provide: CodeqlParentService, useFactory: () => new CodeqlParentService() },
    { provide: CodeqlService, useFactory: () => new CodeqlService() },
    { provide: PlatformCheckService, useFactory: () => new PlatformCheckService() },
  ],
  exports: [PlatformCheckService, CodeqlService, CodeqlParentService],
})
export class CiModule {}
