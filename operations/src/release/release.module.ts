import { Module, type DynamicModule } from '@nestjs/common';
import {
  NPM_PUBLICATION_PORTS,
  NpmPublicationService,
  type NpmPublicationPorts,
} from './npm-publication.service';

@Module({})
export class ReleaseModule {
  static registerNpm(ports: NpmPublicationPorts): DynamicModule {
    return {
      module: ReleaseModule,
      providers: [{ provide: NPM_PUBLICATION_PORTS, useValue: ports }, NpmPublicationService],
      exports: [NpmPublicationService],
    };
  }
}
