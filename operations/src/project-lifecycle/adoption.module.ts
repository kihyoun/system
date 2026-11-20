import { DynamicModule, Module } from '@nestjs/common';
import { AdoptionOptions, Adoption } from './adoption-session';
import { AdoptionService } from './adoption.service';
const ADOPTION_OPTIONS = Symbol('ADOPTION_OPTIONS');
@Module({})
export class AdoptionModule {
  static register(options: AdoptionOptions): DynamicModule {
    return {
      module: AdoptionModule,
      providers: [
        { provide: ADOPTION_OPTIONS, useValue: options },
        {
          provide: Adoption,
          useFactory: (configuration: AdoptionOptions) => new Adoption(configuration),
          inject: [ADOPTION_OPTIONS],
        },
        AdoptionService,
      ],
      exports: [AdoptionService],
    };
  }
}
