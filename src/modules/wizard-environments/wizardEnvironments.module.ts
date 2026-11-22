import { Module } from '@nestjs/common';
import {
  environmentFiles,
  environmentInputs,
  environmentPreflight,
  environmentProject,
  environmentRecipes,
  environmentLease,
} from './ports';
import { EnvironmentStoreService } from './environmentStore.service';
import { EnvironmentContextService } from './environmentContext.service';
import { EnvironmentPreflightService } from './environmentPreflight.service';
import { WizardEnvironmentWorkflowService } from './wizardEnvironmentWorkflow.service';
import {
  NativeEnvironmentProjectAdapter,
  NativeEnvironmentRecipeAdapter,
  nativeEnvironmentFiles,
  nativeEnvironmentInputs,
  environmentAdapters,
} from './nativeEnvironment.adapter';
import { NativeEnvironmentOperationLeaseAdapter } from './operationLease.adapter';

@Module({
  providers: [
    NativeEnvironmentProjectAdapter,
    NativeEnvironmentRecipeAdapter,
    NativeEnvironmentOperationLeaseAdapter,
    { provide: environmentProject, useExisting: NativeEnvironmentProjectAdapter },
    { provide: environmentRecipes, useExisting: NativeEnvironmentRecipeAdapter },
    { provide: environmentFiles, useValue: nativeEnvironmentFiles },
    { provide: environmentInputs, useValue: nativeEnvironmentInputs },
    { provide: environmentPreflight, useValue: environmentAdapters },
    { provide: environmentLease, useExisting: NativeEnvironmentOperationLeaseAdapter },
    EnvironmentStoreService,
    EnvironmentContextService,
    EnvironmentPreflightService,
    WizardEnvironmentWorkflowService,
  ],
  exports: [WizardEnvironmentWorkflowService, EnvironmentPreflightService],
})
export class WizardEnvironmentsModule {}
