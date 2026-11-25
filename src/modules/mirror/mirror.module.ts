import { WizardSourcePublicationService } from './wizardSourcePublication.service';
import { MirrorCiService } from './ci.service';
import { Module } from '@nestjs/common';
import { MirrorService } from './mirror.service';
import { MirrorCredentialsService } from './credentials.service';
import { mirrorPort, NativeMirrorPort } from './ports';
@Module({
  providers: [
    { provide: mirrorPort, useClass: NativeMirrorPort },
    MirrorService,
    MirrorCredentialsService,
    MirrorCiService,
    WizardSourcePublicationService,
  ],
  exports: [
    MirrorService,
    MirrorCredentialsService,
    MirrorCiService,
    WizardSourcePublicationService,
  ],
})
export class MirrorModule {}
