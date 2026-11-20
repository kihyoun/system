import { DynamicModule, Module } from '@nestjs/common';
import { ProductionOptions } from './production-types';
import { Promotion } from './production-session';
import { ProductionService } from './production.service';
const PRODUCTION_OPTIONS = Symbol('PRODUCTION_OPTIONS');
@Module({})
export class ProductionModule {
  static register(options: ProductionOptions = {}): DynamicModule {
    return {
      module: ProductionModule,
      providers: [
        { provide: PRODUCTION_OPTIONS, useValue: options },
        {
          provide: Promotion,
          useFactory: (configuration: ProductionOptions) => new Promotion(configuration),
          inject: [PRODUCTION_OPTIONS],
        },
        ProductionService,
      ],
      exports: [ProductionService],
    };
  }
}
