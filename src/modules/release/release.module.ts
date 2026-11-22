import {
  githubPublicationPorts,
  GithubPublicationService,
  type GithubPublicationPorts,
} from './githubPublication.service';
import { Module, type DynamicModule } from '@nestjs/common';
import {
  npmPublicationPorts,
  NpmPublicationService,
  type NpmPublicationPorts,
} from './npmPublication.service';

@Module({})
export class ReleaseModule {
  static registerGithub(ports: GithubPublicationPorts): DynamicModule {
    return {
      module: ReleaseModule,
      providers: [{ provide: githubPublicationPorts, useValue: ports }, GithubPublicationService],
      exports: [GithubPublicationService],
    };
  }

  static registerNpm(ports: NpmPublicationPorts): DynamicModule {
    return {
      module: ReleaseModule,
      providers: [{ provide: npmPublicationPorts, useValue: ports }, NpmPublicationService],
      exports: [NpmPublicationService],
    };
  }
}
