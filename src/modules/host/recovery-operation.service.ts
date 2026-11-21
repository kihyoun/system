import { Injectable } from '@nestjs/common';
import path from 'node:path';
import { requireValue as ensure } from './install';
import { RecoveryManifestService } from './recovery-manifest';
import { RecoveryImageService } from './recovery-images';

export interface RecoveryOperationInput {
  operation: 'verify' | 'load';
  directory: string;
  checkout: string;
  expectedManifestSha256?: string;
  configuration?: string;
  checksumsOnly?: boolean;
}

/** Offline archive audit and image reconstruction share the manifest authority.
 * Loading never starts services or bypasses the saved selector validation. */
@Injectable()
export class RecoveryOperationService {
  constructor(
    private readonly manifests: RecoveryManifestService,
    private readonly images: RecoveryImageService,
  ) {}

  execute(input: RecoveryOperationInput): 'verified' | 'loaded' {
    ensure(
      input.operation === 'verify' || input.operation === 'load',
      'invalid-recovery-operation',
    );
    ensure(typeof input.directory === 'string' && !!input.directory, 'missing-directory');
    ensure(typeof input.checkout === 'string' && !!input.checkout, 'missing-checkout');
    ensure(
      input.checksumsOnly === undefined || typeof input.checksumsOnly === 'boolean',
      'invalid-checksums-only',
    );
    ensure(
      !(input.operation === 'load' && input.checksumsOnly),
      'legacy-checksums-cannot-load-images',
    );
    ensure(
      !(input.configuration && input.checksumsOnly),
      'legacy-checksums-cannot-validate-configuration',
    );
    const directory = path.resolve(input.directory);
    const manifest = this.manifests.load(
      directory,
      path.resolve(input.checkout),
      input.expectedManifestSha256,
      input.checksumsOnly,
    );
    if (input.configuration)
      this.manifests.validateSelected(manifest, path.resolve(input.configuration));
    if (input.operation === 'load') this.images.restore(directory, manifest);
    return input.operation === 'load' ? 'loaded' : 'verified';
  }
}
