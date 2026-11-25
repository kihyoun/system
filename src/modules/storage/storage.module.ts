import { DynamicModule, Module } from '@nestjs/common';
import { NativeProcessRunner } from '../../common/runtime/process';
import { PreviewNormalizer } from './coordinatedBackup';
import { StorageService, storageProcessRunner, storagePreviewNormalizer } from './storage.service';

@Module({})
export class StorageModule {
  static register(options: { normalizePreview: PreviewNormalizer }): DynamicModule {
    return {
      module: StorageModule,
      providers: [
        { provide: storageProcessRunner, useClass: NativeProcessRunner },
        { provide: storagePreviewNormalizer, useValue: options.normalizePreview },
        StorageService,
      ],
      exports: [StorageService, storageProcessRunner],
    };
  }
}
