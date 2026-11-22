import { DynamicModule, Module } from '@nestjs/common';
import { AdoptionOptions, Adoption } from './adoptionSession';
import { AdoptionService } from './adoption.service';
const adoptionOptions = Symbol('ADOPTION_OPTIONS');
@Module({})
export class AdoptionModule {
  static register(options: AdoptionOptions): DynamicModule {
    return {
      module: AdoptionModule,
      providers: [
        { provide: adoptionOptions, useValue: options },
        {
          provide: Adoption,
          useFactory: (configuration: AdoptionOptions) => new Adoption(configuration),
          inject: [adoptionOptions],
        },
        AdoptionService,
      ],
      exports: [AdoptionService],
    };
  }
}
