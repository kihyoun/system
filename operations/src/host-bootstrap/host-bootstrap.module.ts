import { RuntimeVerificationService } from './runtime-verification.service';
import { HostInitializeService } from './initialize.service';
import { HostInstallService } from '../host/install';
import { QuickstartPreflightService } from './quickstart-preflight.service';
import { QuickstartService } from './quickstart.service';
import { UbuntuHostService } from './ubuntu.service';
import { RetainedRecoveryService } from './recovery.service';
import { Module } from '@nestjs/common';
import { HostCertificateService } from './certificate.service';
import { LocalHostService } from './local.service';
import { BuildToolsModule } from './build-tools.module';
@Module({
  imports: [BuildToolsModule],
  providers: [
    {
      provide: RuntimeVerificationService,
      inject: [HostInstallService],
      useFactory: (host: HostInstallService) => new RuntimeVerificationService(host),
    },
    {
      provide: HostInitializeService,
      inject: [
        RetainedRecoveryService,
        RuntimeVerificationService,
        UbuntuHostService,
        HostCertificateService,
      ],
      useFactory: (
        recovery: RetainedRecoveryService,
        verification: RuntimeVerificationService,
        ubuntu: UbuntuHostService,
        certificates: HostCertificateService,
      ) => new HostInitializeService(recovery, verification, ubuntu, certificates),
    },
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
  ],
  exports: [
    RuntimeVerificationService,
    HostInitializeService,
    QuickstartService,
    BuildToolsModule,
    HostCertificateService,
    LocalHostService,
    UbuntuHostService,
    RetainedRecoveryService,
  ],
})
export class HostBootstrapModule {}
