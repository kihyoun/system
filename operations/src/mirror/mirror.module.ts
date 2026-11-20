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
  ],
  exports: [MirrorService, MirrorCredentialsService, MirrorCiService],
})
export class MirrorModule {}
