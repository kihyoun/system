import { DynamicModule, Module } from '@nestjs/common';
import { DeploymentRequest } from './types';
import { Runtime } from './environment-runtime';
import { EnvironmentService } from './environment.service';
const ENVIRONMENT_REQUEST = Symbol('ENVIRONMENT_REQUEST');
@Module({})
export class EnvironmentModule {
  static register(request: DeploymentRequest): DynamicModule {
    return {
      module: EnvironmentModule,
      providers: [
        { provide: ENVIRONMENT_REQUEST, useValue: request },
        {
          provide: Runtime,
          useFactory: (input: DeploymentRequest) => new Runtime(input),
          inject: [ENVIRONMENT_REQUEST],
        },
        EnvironmentService,
      ],
      exports: [EnvironmentService],
    };
  }
}
