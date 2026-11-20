import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
export interface PreviewJob {
  state: string;
  message?: string;
  [key: string]: unknown;
}
export interface PreviewSetupPort {
  previewSetupStatus(): unknown | Promise<unknown>;
  preflightPreviewSetup(input: { settings: unknown }): unknown | Promise<unknown>;
  applyPreviewSetup(input: { settings: unknown; previewHash: string }): PreviewJob;
}
export const PREVIEW_SETUP_PORT = Symbol('PREVIEW_SETUP_PORT');
@Injectable()
export class PreviewOperatorService {
  constructor(@Inject(PREVIEW_SETUP_PORT) private readonly setup: PreviewSetupPort) {}
  async run(args: string[]) {
    if (args[0] === 'status' && args.length === 1) return this.setup.previewSetupStatus();
    if (!['preflight', 'apply'].includes(args[0]) || args.length !== (args[0] === 'apply' ? 3 : 2))
      throw Error('Use status, preflight SETTINGS_FILE, or apply SETTINGS_FILE PREFLIGHT_HASH.');
    const stat = fs.lstatSync(args[1]);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20000 || stat.mode & 0o077)
      throw Error('Use a private regular settings JSON file.');
    const settings: unknown = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    if (args[0] === 'preflight') return this.setup.preflightPreviewSetup({ settings });
    const job = this.setup.applyPreviewSetup({ settings, previewHash: args[2] });
    while (job.state === 'running') await new Promise((resolve) => setTimeout(resolve, 250));
    if (job.state === 'failed') throw Error(job.message);
    return job;
  }
}
