import { DynamicModule, Module } from '@nestjs/common';
import { CanonicalOptions, CanonicalSession } from './canonical-session';
import { CanonicalService } from './canonical.service';
const CANONICAL_OPTIONS = Symbol('CANONICAL_OPTIONS');
@Module({})
export class CanonicalModule {
  static register(options: CanonicalOptions = {}): DynamicModule {
    return {
      module: CanonicalModule,
      providers: [
        { provide: CANONICAL_OPTIONS, useValue: options },
        {
          provide: CanonicalSession,
          useFactory: (configuration: CanonicalOptions) => new CanonicalSession(configuration),
          inject: [CANONICAL_OPTIONS],
        },
        CanonicalService,
      ],
      exports: [CanonicalService],
    };
  }
}
