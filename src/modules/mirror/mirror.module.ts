import { WizardSourcePublicationService } from './wizard-source-publication.service';
import { MirrorCiService } from './ci.service';
import { Module } from '@nestjs/common';
import { MirrorService } from './mirror.service';
import { MirrorCredentialsService } from './credentials.service';
import { MIRROR_PORT, NativeMirrorPort } from './ports';
@Module({
  providers: [
    { provide: MIRROR_PORT, useClass: NativeMirrorPort },
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
