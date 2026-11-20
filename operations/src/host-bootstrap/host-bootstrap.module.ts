import { UbuntuHostService } from './ubuntu.service';
import { RetainedRecoveryService } from './recovery.service';
import { Module } from '@nestjs/common';
import { HostCertificateService } from './certificate.service';
import { LocalHostService } from './local.service';
import { BuildToolsService } from './build-tools.service';
@Module({
  providers: [
    { provide: UbuntuHostService, useFactory: () => new UbuntuHostService() },
    { provide: RetainedRecoveryService, useFactory: () => new RetainedRecoveryService() },
    { provide: HostCertificateService, useFactory: () => new HostCertificateService() },
    { provide: LocalHostService, useFactory: () => new LocalHostService() },
    { provide: BuildToolsService, useFactory: () => new BuildToolsService() },
  ],
  exports: [
    BuildToolsService,
    HostCertificateService,
    LocalHostService,
    UbuntuHostService,
    RetainedRecoveryService,
  ],
})
export class HostBootstrapModule {}
