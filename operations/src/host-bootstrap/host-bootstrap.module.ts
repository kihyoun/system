import { HostInstallService } from '../host/install';
import { QuickstartPreflightService } from './quickstart-preflight.service';
import { QuickstartService } from './quickstart.service';
import { UbuntuHostService } from './ubuntu.service';
import { RetainedRecoveryService } from './recovery.service';
import { Module } from '@nestjs/common';
import { HostCertificateService } from './certificate.service';
import { LocalHostService } from './local.service';
import { BuildToolsService } from './build-tools.service';
@Module({
  providers: [
    { provide: HostInstallService, useFactory: () => new HostInstallService() },
    { provide: QuickstartPreflightService, useFactory: () => new QuickstartPreflightService() },
    {
      provide: QuickstartService,
      inject: [UbuntuHostService, HostInstallService, QuickstartPreflightService],
      useFactory: (
        ubuntu: UbuntuHostService,
        installer: HostInstallService,
        preflight: QuickstartPreflightService,
      ) => new QuickstartService(undefined, ubuntu, installer, undefined, undefined, preflight),
    },
    { provide: UbuntuHostService, useFactory: () => new UbuntuHostService() },
    { provide: RetainedRecoveryService, useFactory: () => new RetainedRecoveryService() },
    { provide: HostCertificateService, useFactory: () => new HostCertificateService() },
    { provide: LocalHostService, useFactory: () => new LocalHostService() },
    { provide: BuildToolsService, useFactory: () => new BuildToolsService() },
  ],
  exports: [
    QuickstartService,
    BuildToolsService,
    HostCertificateService,
    LocalHostService,
    UbuntuHostService,
    RetainedRecoveryService,
  ],
})
export class HostBootstrapModule {}
