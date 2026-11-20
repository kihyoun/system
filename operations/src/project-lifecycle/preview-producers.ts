import fs from 'node:fs';
import path from 'node:path';
import { SourceAdapter } from './upgrade-types';
import { CiFile } from './source-primary-environment';
const sourceRoot = path.resolve(__dirname, '../../../project-bootstrap');
const source = require(path.join(sourceRoot, 'wizard-source/package')) as SourceAdapter;
// Guided adoption must not approve whatever producer bytes an arbitrary fork
// reports. The accepted controller carries the exact Git-pinned native CI.
export function approvedProducers(
  snapshotFile = path.join(sourceRoot, 'wizard-source/snapshot.json'),
) {
  const snapshot = source.validate(JSON.parse(fs.readFileSync(snapshotFile, 'utf8')));
  return snapshot.files
    .filter((file) => file.path.startsWith('.gitlab/'))
    .map((file) => ({ path: file.path, sha256: file.sha256 }));
}
export function validateProducers(
  files: CiFile[],
  snapshotFile = path.join(sourceRoot, 'wizard-source/snapshot.json'),
) {
  const expected = approvedProducers(snapshotFile);
  for (const name of [
    '.gitlab/primary.yml',
    '.gitlab/test-browser.sh',
    '.gitlab/delivery/environment.sh',
  ]) {
    if (!expected.some((file) => file.path === name))
      throw Error(
        'The accepted controller source snapshot lacks the native Wizard delivery producers.',
      );
  }
  if (
    expected.some(
      (file) =>
        !files.some(
          (candidate) => candidate.path === file.path && candidate.sha256 === file.sha256,
        ),
    ) ||
    files.some(
      (file) =>
        file.path.startsWith('.gitlab/') &&
        !expected.some(
          (candidate) => candidate.path === file.path && candidate.sha256 === file.sha256,
        ),
    )
  )
    throw Error(
      'Native CI producer files differ from the accepted controller snapshot. Preserve the fork changes and use an explicitly reviewed native source-primary manifest instead of guided adoption.',
    );
  return true;
}
