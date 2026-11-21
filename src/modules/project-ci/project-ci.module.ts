import { ApplicationService } from './application.service';
import { ProjectBuildRecipeService } from './recipe.service';
import { BuildToolsModule } from '../host-bootstrap/build-tools.module';
import { DeliveryService } from './delivery.service';
import { DeliverySessionService } from './delivery-session.service';
import { MirrorModule } from '../mirror/mirror.module';
import { Module } from '@nestjs/common';
import { ManagedChildProcess } from '../../common/runtime/managed-child';
import { EnvironmentLauncherService, PROJECT_CI_PROCESS } from './environment-launcher.service';
import { BrowserCheckService, BROWSER_PROBE, NativeBrowserProbe } from './browser-check.service';
@Module({
  imports: [MirrorModule, BuildToolsModule],
  providers: [
    { provide: PROJECT_CI_PROCESS, useClass: ManagedChildProcess },
    { provide: BROWSER_PROBE, useClass: NativeBrowserProbe },
    ApplicationService,
    ProjectBuildRecipeService,
    DeliveryService,
    DeliverySessionService,
    EnvironmentLauncherService,
    BrowserCheckService,
  ],
  exports: [
    ApplicationService,
    ProjectBuildRecipeService,
    DeliveryService,
    EnvironmentLauncherService,
    BrowserCheckService,
  ],
})
export class ProjectCiModule {}
