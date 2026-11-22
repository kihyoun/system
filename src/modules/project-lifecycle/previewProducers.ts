import fs from 'node:fs';
import path from 'node:path';
import { CiFile, producerPaths } from './sourcePrimaryEnvironment';
const sourceRoot = path.resolve(__dirname, '../../..');
import * as source from '../source-preparation/wizardSource.service';
// Guided adoption must not approve whatever producer bytes an arbitrary fork
// reports. The accepted controller carries the exact Git-pinned native CI.
export function approvedProducers(
  snapshotFile = path.join(sourceRoot, 'assets/wizard-source/snapshot.json'),
) {
  const snapshot = source.validate(JSON.parse(fs.readFileSync(snapshotFile, 'utf8')));
  const cliProducer = snapshot.files.find((file) => file.path === '.gitlab/producer-v3.json');

  if (cliProducer) {
    const value = JSON.parse(Buffer.from(cliProducer.content, 'base64').toString('utf8')) as Record<
      string,
      unknown
    >;

    if (
      snapshot.version !== 3 ||
      value.version !== 3 ||
      value.buildProfile !== 'node24-vite8-cli-v7' ||
      value.cliArtifact !== '.gitlab/cli/system-bootstrapper.tgz'
    ) {
      throw Error('Versioned source producer requires its matching CLI package.');
    }
  }

  const producer = snapshot.files.find((file) => file.path === '.gitlab/producer-v2.json');

  if (producer) {
    const value: unknown = JSON.parse(Buffer.from(producer.content, 'base64').toString('utf8'));
    const record = value as Record<string, unknown>;
    const runtime = snapshot.files.find((file) => file.path === '.gitlab/runtime/project-ci.cjs');

    if (
      !record ||
      record.version !== 2 ||
      record.runtime !== '.gitlab/runtime/project-ci.cjs' ||
      record.buildProfile !== 'node24-vite8-typed-v6' ||
      record.runtimeSha256 !== runtime?.sha256
    ) {
      throw Error('Versioned source producer does not match its exact runtime.');
    }
  }

  return snapshot.files
    .filter((file) => file.path.startsWith('.gitlab/'))
    .map((file) => ({ path: file.path, sha256: file.sha256 }));
}
export function validateProducers(
  files: CiFile[],
  snapshotFile = path.join(sourceRoot, 'assets/wizard-source/snapshot.json'),
) {
  const expected = approvedProducers(snapshotFile);
  const required = producerPaths(expected);

  if (
    !expected.some((file) =>
      ['.gitlab/producer-v2.json', '.gitlab/producer-v3.json'].includes(file.path),
    )
  ) {
    required.push('.gitlab/test-browser.sh');
  }

  for (const name of required) {
    if (!expected.some((file) => file.path === name)) {
      throw Error(
        'The accepted controller source snapshot lacks the native Wizard delivery producers.',
      );
    }
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
  ) {
    throw Error(
      'Native CI producer files differ from the accepted controller snapshot. Preserve the fork changes and use an explicitly reviewed native source-primary manifest instead of guided adoption.',
    );
  }

  return true;
}
