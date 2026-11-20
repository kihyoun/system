import { Module } from '@nestjs/common';
import { ManagedChildProcess } from '../runtime/managed-child';
import { EnvironmentLauncherService, PROJECT_CI_PROCESS } from './environment-launcher.service';
import { BrowserCheckService, BROWSER_PROBE, NativeBrowserProbe } from './browser-check.service';
@Module({
  providers: [
    { provide: PROJECT_CI_PROCESS, useClass: ManagedChildProcess },
    { provide: BROWSER_PROBE, useClass: NativeBrowserProbe },
    EnvironmentLauncherService,
    BrowserCheckService,
  ],
  exports: [EnvironmentLauncherService, BrowserCheckService],
})
export class ProjectCiModule {}
