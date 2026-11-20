import fs from 'node:fs';
import { Request } from 'express';
import { mainConfigPath, wizardConfigPath } from './StatePaths';
import { readSettings } from './DefaultWizard';

function origin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

/** Exact operator origins; never trust forwarded headers supplied by a client. */
export function allowedBrowserOrigin(req: Request): boolean {
  const supplied = req.get('Origin');
  if (!supplied) return true;
  const selected = origin(supplied);
  if (!selected || selected !== supplied) return false;
  const allowed = new Set<string>();
  // Same-origin access covers the documented SSH tunnel /sync route.
  const sameOrigin = origin(req.protocol + '://' + req.get('Host'));
  if (sameOrigin) allowed.add(sameOrigin);
  const settings = fs.existsSync(mainConfigPath())
    ? readSettings(fs.readFileSync(mainConfigPath(), 'utf8'))
    : process.env;
  for (const prefix of ['WIZARD', 'SYNC']) {
    if (settings[prefix + '_HOST']) {
      const configured = origin(
        (Number(settings[prefix + '_DOMAIN_MODE']) > 1 ? 'https://' : 'http://') +
          settings[prefix + '_HOST'],
      );
      if (configured) allowed.add(configured);
    }
  }
  // Extra local/offline clients need explicit exact origins, preserved as runtime options.
  for (const value of String(settings.SYNC_ALLOWED_ORIGINS || '').split(/[\s,]+/)) {
    const configured = origin(value);
    if (configured) allowed.add(configured);
  }
  if (fs.existsSync(wizardConfigPath())) {
    const wizard = readSettings(fs.readFileSync(wizardConfigPath(), 'utf8'));
    for (const prefix of ['BETA', 'REVIEW']) {
      if (wizard['USE_' + prefix + '_HOST'] !== 'true') continue;
      const configured = origin(
        (Number(wizard[prefix + '_DOMAIN_MODE']) > 1 ? 'https://' : 'http://') +
          String(wizard[prefix + '_HOST'] || ''),
      );
      if (configured) allowed.add(configured);
    }
  }
  return allowed.has(selected);
}
