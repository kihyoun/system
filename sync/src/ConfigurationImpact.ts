import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { configDirectory } from './StatePaths';
const routing = require('../../nginx/wizard-aliases');
const application = require('../../nginx/application-aliases');
const planner = require('../../project-bootstrap/routing-impact');
const { validateArchive } = require('../../project-bootstrap/configuration-archive');

// Preflight uses private temporary data and never changes the saved installation.
export function configurationImpact(data: Buffer) {
  if (data.length > 16 * 1024 * 1024) throw new Error('Configuration archive is too large.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'system-config-impact-'));
  try {
    const archive = path.join(temporary, 'configuration.zip'),
      extracted = path.join(temporary, 'archive');
    fs.writeFileSync(archive, data, { mode: 0o600 });
    const entries: string[] = validateArchive(archive);
    execFileSync('unzip', ['-q', archive, '-d', extracted], {
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    let size = 0;
    for (const name of entries.filter((name) => !name.endsWith('/'))) {
      const file = path.join(extracted, name),
        info = fs.lstatSync(file);
      if (!info.isFile() || info.size > 4 * 1024 * 1024 || (size += info.size) > 32 * 1024 * 1024)
        throw new Error('Invalid configuration archive file.');
    }
    routing.validateImport(extracted, configDirectory());
    const imported = application.imported(extracted, configDirectory());
    application.validate(
      imported.main,
      imported.projects.map((file: { content: string }) => file.content),
      fs.existsSync(path.join(configDirectory(), '.docker.env')),
    );
    return planner.impact(extracted, configDirectory());
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
