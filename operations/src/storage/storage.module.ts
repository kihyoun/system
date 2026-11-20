import {DynamicModule, Module} from '@nestjs/common';
import {NativeProcessRunner} from '../runtime/process';
import {PreviewNormalizer} from './coordinated-backup';
import {StorageService, STORAGE_PROCESS_RUNNER, STORAGE_PREVIEW_NORMALIZER} from './storage.service';

@Module({})
export class StorageModule {
  static register(options: {normalizePreview: PreviewNormalizer}): DynamicModule {
    return {module:StorageModule,providers:[
      {provide:STORAGE_PROCESS_RUNNER,useClass:NativeProcessRunner},
      {provide:STORAGE_PREVIEW_NORMALIZER,useValue:options.normalizePreview},StorageService,
    ],exports:[StorageService,STORAGE_PROCESS_RUNNER]};
  }
}
