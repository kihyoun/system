import { publicPackagePayload } from '../../common/publicPayload';
import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { CommittedContextService, contextHash } from './committedContext.service';
import { includedCodeql } from './contextSelection';
import { verifiedGeneratedArtifacts } from './generatedArtifactPolicy';
@Injectable()
export class CodeqlContextService {
  constructor(private readonly context: CommittedContextService) {}

  prepare(directory: string, environment: NodeJS.ProcessEnv = process.env) {
    const root = path.resolve(directory),
      revision = this.context.git(root, ['rev-parse', 'HEAD'], environment).toString().trim(),
      snapshot = this.context.snapshot(root);
    const sourceEntries = this.context.entries(root, 'HEAD', environment);
    this.context.verifySourceSelection(sourceEntries, includedCodeql);
    const entries = sourceEntries.filter(
      (entry) =>
        entry.name !== 'wizard' && !entry.name.startsWith('wizard/') && includedCodeql(entry.name),
    );
    this.context.requireRegular(
      entries,
      'Static scan context refuses source links and nested submodules.',
    );
    for (const required of ['tests/codeql/Dockerfile', 'src/modules/ci/codeql.service.ts']) {
      if (!entries.some((entry) => entry.name === required)) {
        throw Error('Committed CodeQL tooling is incomplete.');
      }
    }
    const output = this.context.output(root, '.codeql-context'),
      temporary = fs.mkdtempSync(path.join(output, '.prepare-'));
    try {
      const source = path.join(temporary, 'source'),
        archive = path.join(temporary, 'context.tar');
      fs.mkdirSync(source);
      this.context.archive(root, entries, archive, source, environment);
      // Historical managed recipes remain scan inputs at the exact public Wizard pin.
      const shared = snapshot.sourceLayout === 'system-monorepo-v1',
        wizard = shared ? root : path.join(root, 'wizard'),
        wizardTree = shared ? snapshot.wizardSourceTree! : snapshot.sourceRevision;
      const wizardFiles = this.context
        .entries(root, wizardTree, environment, wizard)
        .filter((entry) => includedCodeql(entry.name));
      this.context.requireRegular(
        wizardFiles,
        'Static scan refuses Wizard links and nested submodules.',
      );
      fs.mkdirSync(path.join(source, 'wizard'));
      this.context.archive(
        root,
        wizardFiles,
        path.join(temporary, 'wizard.tar'),
        path.join(source, 'wizard'),
        environment,
        wizardTree,
        wizard,
      );
      const committed = [
        ...entries,
        ...wizardFiles.map((entry) => ({ ...entry, name: 'wizard/' + entry.name })),
      ];
      // The committed provider identifies the native package's exact payload contract.
      // Earlier source pins retain their own tooling without inventing new dependencies.
      const toolingFiles = committed.some((entry) => entry.name === 'src/common/publicPayload.ts')
        ? [...publicPackagePayload]
        : [];
      // Preserve compiler dependencies outside the scanned tree before removing its exact artifacts.
      for (const name of toolingFiles) {
        const entry = committed.find((file) => file.name === name);

        if (!entry) {
          throw Error('Committed public runtime input is missing: ' + name);
        }

        this.context.requireRegular(
          [entry],
          'Public runtime input must be a committed regular file.',
        );
        this.context.write(
          path.join(temporary, 'tooling'),
          name,
          fs.readFileSync(path.join(source, name)),
          entry.mode,
        );
      }
      const excludedGenerated = verifiedGeneratedArtifacts(source, committed),
        excluded = new Set(excludedGenerated.map((entry) => entry.path));
      for (const name of excluded) {
        fs.unlinkSync(path.join(source, name));
      }
      const files = committed
        .map((entry) => entry.name)
        .filter((name) => !excluded.has(name))
        .sort();
      const manifest = {
        revision,
        ...(shared
          ? {
              sourceLayout: snapshot.sourceLayout,
              sourceRevision: snapshot.sourceRevision,
              wizardSourceTree: snapshot.wizardSourceTree,
            }
          : { wizardRevision: snapshot.sourceRevision }),
        files,
        excludedGenerated,
      };
      this.context.write(source, 'scan-source.json', JSON.stringify(manifest) + '\n');
      this.context.pack(
        temporary,
        archive,
        ['source', ...(toolingFiles.length ? ['tooling'] : [])],
        environment,
      );
      this.context.verifyArchive(
        archive,
        [...files, 'scan-source.json']
          .map((name) => 'source/' + name)
          .concat(toolingFiles.map((name) => 'tooling/' + name)),
        environment,
      );
      const checksum = contextHash(fs.readFileSync(archive));
      this.context.publish(output, temporary, revision, { ...manifest, checksum });
      return manifest;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}
