import { DynamicModule, Module } from '@nestjs/common';
import { ProductionOptions } from './productionTypes';
import { Promotion } from './productionSession';
import { ProductionService } from './production.service';
import { DeploymentEvidenceModule } from './deploymentEvidence.module';
import { DeploymentEvidenceService } from './deploymentEvidence.service';
const productionOptions = Symbol('PRODUCTION_OPTIONS');
@Module({})
export class ProductionModule {
  static register(options: ProductionOptions = {}): DynamicModule {
    return {
      module: ProductionModule,
      imports: [DeploymentEvidenceModule],
      providers: [
        { provide: productionOptions, useValue: options },
        {
          provide: Promotion,
          useFactory: (configuration: ProductionOptions, evidence: DeploymentEvidenceService) =>
            new Promotion(configuration, evidence),
          inject: [productionOptions, DeploymentEvidenceService],
        },
        ProductionService,
      ],
      exports: [ProductionService],
    };
  }
}
