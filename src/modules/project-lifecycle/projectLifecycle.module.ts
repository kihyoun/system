import { LegacyBuildRecipeService } from './legacyBuildRecipe.service';
import { BuildRecipeService } from './buildRecipe.service';
import { EnvironmentRecipeService } from './environmentRecipe.service';
import {
  SourceTransferService,
  sourceTransferPort,
  nativeSourceTransferPort,
} from './sourceTransfer.service';
import { Module } from '@nestjs/common';
import { ProjectLifecycleService } from './projectLifecycle.service';
@Module({
  providers: [
    LegacyBuildRecipeService,
    BuildRecipeService,
    EnvironmentRecipeService,
    ProjectLifecycleService,
    SourceTransferService,
    { provide: sourceTransferPort, useValue: nativeSourceTransferPort },
  ],
  exports: [
    ProjectLifecycleService,
    SourceTransferService,
    LegacyBuildRecipeService,
    BuildRecipeService,
    EnvironmentRecipeService,
  ],
})
export class ProjectLifecycleModule {}
