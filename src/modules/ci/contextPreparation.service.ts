import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { CommittedContextService, contextHash } from './committedContext.service';
import { includedTest, includedCandidate } from './contextSelection';
import { sourceMetadata } from '../source-preparation/wizardSource.service';
export interface PreparedContext {
  revision: string;
  files: string[];
  archiveHash?: string;
  checksum?: string;
  [key: string]: unknown;
}
@Injectable()
export class ContextPreparationService {
  constructor(private readonly context: CommittedContextService) {}

  prepareContext(root: string, environment: NodeJS.ProcessEnv = process.env): PreparedContext {
    return this.prepare(root, 'test', environment);
  }

  prepareCandidate(root: string, environment: NodeJS.ProcessEnv = process.env): PreparedContext {
    return this.prepare(root, 'candidate', environment);
  }

  private prepare(
    directory: string,
    kind: 'test' | 'candidate',
    environment: NodeJS.ProcessEnv,
  ): PreparedContext {
    const root = path.resolve(directory),
      revision = this.context.git(root, ['rev-parse', 'HEAD'], environment).toString().trim(),
      snapshot = this.context.snapshot(root);
    const included = kind === 'test' ? includedTest : includedCandidate,
      entries = this.context.entries(root, 'HEAD', environment);
    this.context.verifySourceSelection(entries, included);
    const files = entries.filter((file) => included(file.name));
    this.context.requireRegular(files, 'Context refuses links and nested submodules.');

    if (
      !files.some((file) => file.name === 'package.json') ||
      !files.some((file) => file.name === 'src/cli/main.ts')
    ) {
      throw Error('Committed shared runtime inputs are incomplete.');
    }

    if (kind === 'test') {
      if (!files.some((file) => file.name === 'tests/Dockerfile')) {
        throw Error('The committed test build inputs are incomplete.');
      }
    } else {
      const wizardInputs =
        snapshot.version >= 2
          ? ['Dockerfile', 'nginx/nginx.conf', 'package.json', 'package-lock.json']
          : ['start.sh'];

      if (
        !files.some((file) => file.name === 'containers/controller/Dockerfile') ||
        !wizardInputs.every((name) => snapshot.files.some((file) => file.path === name))
      ) {
        throw Error('Incomplete full-System candidate source.');
      }
    }

    const output = this.context.output(
        root,
        kind === 'test' ? '.test-context' : '.candidate-context',
      ),
      temporary = fs.mkdtempSync(path.join(output, '.prepare-'));
    try {
      const archive = path.join(temporary, 'context.tar');
      this.context.archive(root, files, archive, temporary, environment);
      const additions = this.context.stageSnapshot(temporary, snapshot),
        expected = [...files.map((file) => file.name), ...additions].sort();
      this.context.pack(temporary, archive, expected, environment);
      this.context.verifyArchive(archive, expected, environment);
      const checksum = contextHash(fs.readFileSync(archive));
      const identity =
        kind === 'test'
          ? snapshot.version >= 2
            ? sourceMetadata(snapshot)
            : { wizardRevision: snapshot.sourceRevision }
          : snapshot.version >= 2
            ? { sourceLayout: snapshot.sourceLayout, wizardSourceTree: snapshot.wizardSourceTree }
            : { wizardRevision: snapshot.sourceRevision };
      const result: PreparedContext = {
        revision,
        ...identity,
        files: expected,
        ...(kind === 'test' ? { archiveHash: checksum } : { checksum }),
      };
      this.context.publish(output, temporary, revision, {
        ...result,
        ...(kind === 'test' ? { snapshotManifest: snapshot.manifestHash } : {}),
      });
      return result;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}
