import { DynamicModule, Module } from '@nestjs/common';
import { ProductionOptions } from './production-types';
import { Promotion } from './production-session';
import { ProductionService } from './production.service';
import { DeploymentEvidenceModule } from './deployment-evidence.module';
import { DeploymentEvidenceService } from './deployment-evidence.service';
const PRODUCTION_OPTIONS = Symbol('PRODUCTION_OPTIONS');
@Module({})
export class ProductionModule {
  static register(options: ProductionOptions = {}): DynamicModule {
    return {
      module: ProductionModule,
      imports: [DeploymentEvidenceModule],
      providers: [
        { provide: PRODUCTION_OPTIONS, useValue: options },
        {
          provide: Promotion,
          useFactory: (configuration: ProductionOptions, evidence: DeploymentEvidenceService) =>
            new Promotion(configuration, evidence),
          inject: [PRODUCTION_OPTIONS, DeploymentEvidenceService],
        },
        ProductionService,
      ],
      exports: [ProductionService],
    };
  }
}
