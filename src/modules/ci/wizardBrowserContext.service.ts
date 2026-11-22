import { publicPackagePayload } from '../../common/publicPayload';
import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { CommittedContextService, contextHash } from './committedContext.service';
import { includedCandidate } from './contextSelection';
const runtimeInputs = ['project-ci.cjs', 'LICENSES.txt'];
const systemInputs = [
  'tests/wizard-browser.Dockerfile',
  '.prettierrc',
  '.prettierignore',
  'LICENSE',
  ...publicPackagePayload.filter((name) => !name.startsWith('wizard/')),
  ...runtimeInputs.map(
    (name) => 'templates/project-bootstrap/wizard-build/typed-v6/runtime/' + name,
  ),
];
@Injectable()
export class WizardBrowserContextService {
  constructor(private readonly context: CommittedContextService) {}

  prepareWizardBrowser(directory: string, environment: NodeJS.ProcessEnv = process.env) {
    const root = path.resolve(directory),
      revision = this.context.git(root, ['rev-parse', 'HEAD'], environment).toString().trim();
    const entry = this.context
        .git(root, ['ls-tree', 'HEAD', 'wizard'], environment)
        .toString()
        .trim(),
      pin = /^160000 commit ([a-f0-9]{40})\twizard$/.exec(entry),
      tree = /^040000 tree ([a-f0-9]{40})\twizard$/.exec(entry);
    const snapshot = this.context.snapshot(root);

    if (
      snapshot.version >= 2
        ? !tree || tree[1] !== snapshot.wizardSourceTree || revision !== snapshot.sourceRevision
        : !pin || pin[1] !== snapshot.sourceRevision
    ) {
      throw Error('Browser snapshot must match the committed Wizard source layout.');
    }

    const provenance =
      snapshot.version >= 2
        ? {
            sourceLayout: snapshot.sourceLayout,
            sourceRevision: snapshot.sourceRevision,
            wizardSourceTree: snapshot.wizardSourceTree,
          }
        : { wizardRevision: snapshot.sourceRevision };
    const entries = this.context.entries(root, 'HEAD', environment);
    this.context.verifySourceSelection(entries, includedCandidate);
    const operationInputs = entries
      .filter(
        (entry) =>
          (/^src\/.*\.[cm]?ts$/.test(entry.name) ||
            entry.name.startsWith('config/') ||
            ['package.json', 'package-lock.json', 'tsconfig.json'].includes(entry.name)) &&
          includedCandidate(entry.name),
      )
      .map((entry) => entry.name);
    const inputs = [...new Set([...systemInputs, ...operationInputs])];
    const committed = inputs.map((name) => {
      const entry = entries.find((entry) => entry.name === name);

      if (!entry) {
        throw Error('Browser build input must be a committed regular file: ' + name);
      }

      this.context.requireRegular(
        [entry],
        'Browser build input must be a committed regular file: ' + name,
      );
      return {
        name,
        mode: entry.mode,
        content: this.context.git(root, ['show', 'HEAD:' + name], environment),
      };
    });
    const wizardRoot = snapshot.version >= 2 ? root : path.join(root, 'wizard'),
      wizardRef = snapshot.version >= 2 ? tree![1] : pin![1];
    const wizardEntries = this.context.entries(root, wizardRef, environment, wizardRoot);
    for (const filename of snapshot.version === 3 ? [] : runtimeInputs) {
      const name = '.system-bootstrapper/build-v2/runtime/' + filename,
        entry = wizardEntries.find((entry) => entry.name === name);

      if (!entry) {
        throw Error('Browser build input must be a committed regular file: wizard/' + name);
      }

      this.context.requireRegular(
        [entry],
        'Browser build input must be a committed regular file: wizard/' + name,
      );
      committed.push({
        name: 'wizard/' + name,
        mode: entry.mode,
        content: this.context.git(root, ['show', wizardRef + ':' + name], environment, wizardRoot),
      });
    }
    for (const required of ['package.json', 'package-lock.json', 'playwright.config.ts']) {
      if (!snapshot.files.some((file) => file.path === required)) {
        throw Error('Incomplete Wizard browser inputs: ' + required);
      }
    }

    if (!snapshot.files.some((file) => file.path.startsWith('tests/browser/'))) {
      throw Error('Wizard browser suite is missing.');
    }

    const output = this.context.output(root, '.wizard-browser-context'),
      temporary = fs.mkdtempSync(path.join(output, '.prepare-'));
    try {
      for (const file of committed) {
        this.context.write(temporary, file.name, file.content, file.mode);
      }
      const files = [
          ...committed.map((file) => file.name),
          ...this.context.stageWizard(temporary, snapshot.files),
        ].sort(),
        archive = path.join(temporary, 'context.tar');
      this.context.pack(temporary, archive, files, environment);
      this.context.verifyArchive(archive, files, environment);
      const checksum = contextHash(fs.readFileSync(archive)),
        result = { revision, ...provenance, checksum, files };
      this.context.publish(output, temporary, revision, {
        ...result,
        snapshotManifest: snapshot.manifestHash,
      });
      return result;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}
