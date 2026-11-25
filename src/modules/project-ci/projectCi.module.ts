import { ApplicationService } from './application.service';
import { ProjectBuildRecipeService } from './recipe.service';
import { BuildToolsModule } from '../host-bootstrap/buildTools.module';
import { DeliveryService } from './delivery.service';
import { DeliverySessionService } from './deliverySession.service';
import { MirrorModule } from '../mirror/mirror.module';
import { Module } from '@nestjs/common';
import { ManagedChildProcess } from '../../common/runtime/managedChild';
import { EnvironmentLauncherService, projectCiProcess } from './environmentLauncher.service';
import { BrowserCheckService, browserProbe, NativeBrowserProbe } from './browserCheck.service';
import { BrowserSmokeService } from './browserSmoke.service';
@Module({
  imports: [MirrorModule, BuildToolsModule],
  providers: [
    { provide: projectCiProcess, useClass: ManagedChildProcess },
    { provide: browserProbe, useClass: NativeBrowserProbe },
    ApplicationService,
    ProjectBuildRecipeService,
    DeliveryService,
    DeliverySessionService,
    EnvironmentLauncherService,
    BrowserCheckService,
    BrowserSmokeService,
  ],
  exports: [
    ApplicationService,
    ProjectBuildRecipeService,
    DeliveryService,
    EnvironmentLauncherService,
    BrowserCheckService,
    BrowserSmokeService,
  ],
})
export class ProjectCiModule {}
