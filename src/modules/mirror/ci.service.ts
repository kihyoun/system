import { Injectable } from '@nestjs/common';
import path from 'node:path';
import { WizardSourcePublicationService } from './wizardSourcePublication.service';
import { MirrorService } from './mirror.service';
import { MirrorCredentialsService } from './credentials.service';
import { MirrorContext } from './ports';
import { eligibility } from './policy';
@Injectable()
export class MirrorCiService {
  constructor(
    private readonly mirror: MirrorService,
    private readonly credentials: MirrorCredentialsService,
    private readonly wizardSource: WizardSourcePublicationService,
  ) {}

  async publish(context: MirrorContext, legacyWizard: boolean): Promise<string> {
    const skip = eligibility(context.env);

    if (skip) {
      return 'GitHub backup skipped: ' + skip;
    }

    return this.credentials.using(context, async (clean, directory) => {
      if (legacyWizard && clean.env.WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED === 'true') {
        const kind = this.wizardSource.sourceKind(clean);

        if (kind === 'gitlink') {
          const selector = clean.env.WIZARD_GITHUB_SSH_PRIVATE_KEY;

          if (!selector) {
            throw Error('protected Wizard SSH file variable missing');
          }

          const identity = this.credentials.identity(
            selector,
            path.join(directory, 'wizard-identity'),
            clean,
          );
          const env: NodeJS.ProcessEnv = { ...clean.env, GITHUB_BACKUP_IDENTITY_FILE: identity };
          delete env.WIZARD_GITHUB_SSH_PRIVATE_KEY;
          await this.wizardSource.publish({ ...clean, env });
        } else if (kind !== 'tree') {
          throw Error('Wizard source layout could not be verified');
        }
      }

      return this.mirror.publish(clean);
    });
  }
}
