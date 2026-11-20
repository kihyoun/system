import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Compatibility adapter to the shared versioned preview-settings validator. */
export function normalizePreview(input: unknown): unknown {
  const packaged = resolve(__dirname, '../../assets/project-bootstrap/preview-setup/settings.js');
  const checkout = resolve(__dirname, '../../../project-bootstrap/preview-setup/settings.js');
  const filename = existsSync(packaged) ? packaged : checkout;
  const adapter: unknown = require(filename);
  if (
    !adapter ||
    typeof adapter !== 'object' ||
    !('settings' in adapter) ||
    typeof adapter.settings !== 'function'
  ) {
    throw new Error('preview-settings-adapter-unavailable');
  }
  return adapter.settings(input);
}
