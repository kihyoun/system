import { LegacyBuildRecipeService } from './legacy-build-recipe.service';
import { BuildRecipeService } from './build-recipe.service';
import { EnvironmentRecipeService } from './environment-recipe.service';
import {
  SourceTransferService,
  SOURCE_TRANSFER_PORT,
  nativeSourceTransferPort,
} from './source-transfer.service';
import { Module } from '@nestjs/common';
import { ProjectLifecycleService } from './project-lifecycle.service';
@Module({
  providers: [
    LegacyBuildRecipeService,
    BuildRecipeService,
    EnvironmentRecipeService,
    ProjectLifecycleService,
    SourceTransferService,
    { provide: SOURCE_TRANSFER_PORT, useValue: nativeSourceTransferPort },
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
