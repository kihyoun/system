import { DynamicModule, Module } from '@nestjs/common';
import { DeploymentRequest } from './types';
import { Runtime } from './environmentRuntime';
import { EnvironmentService } from './environment.service';
const environmentRequest = Symbol('ENVIRONMENT_REQUEST');
@Module({})
export class EnvironmentModule {
  static register(request: DeploymentRequest): DynamicModule {
    return {
      module: EnvironmentModule,
      providers: [
        { provide: environmentRequest, useValue: request },
        {
          provide: Runtime,
          useFactory: (input: DeploymentRequest) => new Runtime(input),
          inject: [environmentRequest],
        },
        EnvironmentService,
      ],
      exports: [EnvironmentService],
    };
  }
}
