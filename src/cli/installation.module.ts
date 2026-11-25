import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { HostInstallService } from '../modules/host/install';
import {
  CliInstallationService,
  cliInstallationPaths,
  nativeCliInstallationPaths,
} from '../modules/host-bootstrap/cliInstallation.service';

@Module({
  providers: [
    { provide: HostInstallService, useFactory: () => new HostInstallService() },
    { provide: cliInstallationPaths, useFactory: nativeCliInstallationPaths },
    CliInstallationService,
  ],
  exports: [CliInstallationService],
})
export class CliInstallationModule {}
