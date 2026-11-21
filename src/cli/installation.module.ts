import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { HostInstallService } from '../modules/host/install';
import {
  CliInstallationService,
  CLI_INSTALLATION_PATHS,
  nativeCliInstallationPaths,
} from '../modules/host-bootstrap/cli-installation.service';

@Module({
  providers: [
    { provide: HostInstallService, useFactory: () => new HostInstallService() },
    { provide: CLI_INSTALLATION_PATHS, useFactory: nativeCliInstallationPaths },
    CliInstallationService,
  ],
  exports: [CliInstallationService],
})
export class CliInstallationModule {}
