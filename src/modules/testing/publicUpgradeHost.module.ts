import { Module, type DynamicModule } from '@nestjs/common';
import { HostModule } from '../host/host.module';
import { PublicUpgradeService } from '../host/publicUpgrade.service';
import { UpgradePrerequisiteService } from '../host/upgradePrerequisite.service';
import { lifecyclePolicy } from '../release/lifecyclePolicy';
import { PublicUpgradePublicationService } from './publicUpgradePublication.service';
import { PublicUpgradeSelectionService } from './publicUpgradeSelection.service';
import { PublicUpgradeHostService, fixtureHostProcess } from './publicUpgradeHost.service';
import { PublicGitlabPrerequisiteService } from '../host/publicGitlabPrerequisite.service';
@Module({})
export class PublicUpgradeHostModule {
  static register(directory: string, checkout: string): DynamicModule {
    // Each invocation owns its own transport state and Nest context.
    let request: typeof fetch = async () => {
      throw Error('fixture-publication-not-initialized');
    };
    return {
      module: PublicUpgradeHostModule,
      imports: [
        HostModule.register({
          lifecycleEvidence: lifecyclePolicy(),
          runner: fixtureHostProcess,
          publicHostFacts: {
            release: { ID: 'ubuntu', VERSION_ID: '24.04' },
            architecture: 'x64',
            memoryBytes: 8 * 1024 ** 3,
          },
          publicReleaseRequest: (...args) => request(...args),
        }),
      ],
      providers: [
        PublicUpgradeSelectionService,
        {
          provide: PublicUpgradePublicationService,
          inject: [UpgradePrerequisiteService],
          useFactory: (prerequisite: UpgradePrerequisiteService) =>
            new PublicUpgradePublicationService(prerequisite),
        },
        {
          provide: PublicUpgradeHostService,
          inject: [
            PublicUpgradeService,
            PublicUpgradeSelectionService,
            PublicUpgradePublicationService,
            PublicGitlabPrerequisiteService,
          ],
          useFactory: (
            upgrade: PublicUpgradeService,
            selection: PublicUpgradeSelectionService,
            publication: PublicUpgradePublicationService,
            gitlab: PublicGitlabPrerequisiteService,
          ) => {
            const service = new PublicUpgradeHostService(upgrade, selection, publication, gitlab);
            request = service.transport(directory, checkout);
            return service;
          },
        },
      ],
      exports: [PublicUpgradeHostService],
    };
  }
}
