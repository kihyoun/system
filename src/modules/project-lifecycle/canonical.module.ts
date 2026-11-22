import { DynamicModule, Module } from '@nestjs/common';
import { CanonicalOptions, CanonicalSession } from './canonicalSession';
import { CanonicalService } from './canonical.service';
const canonicalOptions = Symbol('CANONICAL_OPTIONS');
@Module({})
export class CanonicalModule {
  static register(options: CanonicalOptions = {}): DynamicModule {
    return {
      module: CanonicalModule,
      providers: [
        { provide: canonicalOptions, useValue: options },
        {
          provide: CanonicalSession,
          useFactory: (configuration: CanonicalOptions) => new CanonicalSession(configuration),
          inject: [canonicalOptions],
        },
        CanonicalService,
      ],
      exports: [CanonicalService],
    };
  }
}
