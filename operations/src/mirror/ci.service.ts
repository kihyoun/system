import { Inject, Injectable } from '@nestjs/common';
import path from 'node:path';
import { MirrorService } from './mirror.service';
import { MirrorCredentialsService } from './credentials.service';
import { MIRROR_PORT, MirrorPort, MirrorContext } from './ports';
import { eligibility } from './policy';
@Injectable()
export class MirrorCiService {
  constructor(
    private readonly mirror: MirrorService,
    private readonly credentials: MirrorCredentialsService,
    @Inject(MIRROR_PORT) private readonly port: MirrorPort,
  ) {}
  async publish(context: MirrorContext, legacyWizard: boolean): Promise<string> {
    const skip = eligibility(context.env);
    if (skip) return 'GitHub backup skipped: ' + skip;
    return this.credentials.using(context, async (clean, directory) => {
      if (legacyWizard && clean.env.WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED === 'true') {
        const script = path.resolve(__dirname, '../../../gitlab/publish-wizard-source.js');
        let kind: string;
        try {
          kind = this.port.command(process.execPath, [script, '--source-kind'], clean);
        } catch {
          throw Error('Wizard source layout could not be verified');
        }
        if (kind === 'gitlink') {
          const selector = clean.env.WIZARD_GITHUB_SSH_PRIVATE_KEY;
          if (!selector) throw Error('protected Wizard SSH file variable missing');
          const identity = this.credentials.identity(
            selector,
            path.join(directory, 'wizard-identity'),
            clean,
          );
          const env: NodeJS.ProcessEnv = { ...clean.env, GITHUB_BACKUP_IDENTITY_FILE: identity };
          delete env.WIZARD_GITHUB_SSH_PRIVATE_KEY;
          this.port.command(process.execPath, [script], { ...clean, env });
        } else if (kind !== 'tree') throw Error('Wizard source layout could not be verified');
      }
      return this.mirror.publish(clean);
    });
  }
}
