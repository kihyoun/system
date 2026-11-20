import {
  GITHUB_PUBLICATION_PORTS,
  GithubPublicationService,
  type GithubPublicationPorts,
} from './github-publication.service';
import { Module, type DynamicModule } from '@nestjs/common';
import {
  NPM_PUBLICATION_PORTS,
  NpmPublicationService,
  type NpmPublicationPorts,
} from './npm-publication.service';

@Module({})
export class ReleaseModule {
  static registerGithub(ports: GithubPublicationPorts): DynamicModule {
    return {
      module: ReleaseModule,
      providers: [{ provide: GITHUB_PUBLICATION_PORTS, useValue: ports }, GithubPublicationService],
      exports: [GithubPublicationService],
    };
  }
  static registerNpm(ports: NpmPublicationPorts): DynamicModule {
    return {
      module: ReleaseModule,
      providers: [{ provide: NPM_PUBLICATION_PORTS, useValue: ports }, NpmPublicationService],
      exports: [NpmPublicationService],
    };
  }
}
