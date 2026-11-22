import { extractorIncludes, assessCodeql } from './codeqlPolicy';
import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managedChild';
/** Run the pinned extractor and repository coverage gate against public source only. */
@Injectable()
export class CodeqlService {
  constructor(private readonly process: LifecycleProcess = new ManagedChildProcess()) {}

  async scan(
    source: string,
    reports: string,
    environment: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ) {
    if (!path.isAbsolute(source) || !path.isAbsolute(reports)) {
      throw Error('absolute-scan-paths-required');
    }

    fs.mkdirSync(reports, { recursive: true });
    const env = { ...environment };
    for (const key of ['LGTM_INDEX_EXCLUDE', 'LGTM_INDEX_FILTERS', 'LGTM_REPOSITORY_FOLDERS_CSV']) {
      delete env[key];
    }
    const run = (binary: string, args: string[], inherit = false) =>
      this.process.run(binary, args, {
        cwd: source,
        env,
        signal,
        timeout: null,
        inherit,
        maxBuffer: 8 * 1024 * 1024,
      });
    const codeql = env.CODEQL_BINARY || '/opt/codeql/codeql';
    const version = await run(codeql, ['version', '--format=json']);
    const metadata: unknown = JSON.parse(version);

    if (
      !metadata ||
      typeof metadata !== 'object' ||
      !('version' in metadata) ||
      metadata.version !== '2.27.4'
    ) {
      throw Error('pinned-codeql-version-required');
    }

    fs.writeFileSync(path.join(reports, 'tool.json'), version);
    env.LGTM_INDEX_INCLUDE = extractorIncludes(source).join('\n');
    await run(
      codeql,
      [
        'database',
        'create',
        path.join(reports, 'database'),
        '--language=javascript',
        '--build-mode=none',
        `--source-root=${source}`,
        '--threads=2',
        '--ram=4096',
      ],
      true,
    );
    await run(
      codeql,
      [
        'database',
        'analyze',
        path.join(reports, 'database'),
        'codeql/javascript-queries:codeql-suites/javascript-code-scanning.qls',
        '--threads=2',
        '--ram=4096',
        '--format=sarifv2.1.0',
        '--sarif-category=javascript-typescript',
        '--sarif-add-baseline-file-info',
        `--output=${path.join(reports, 'results.sarif')}`,
      ],
      true,
    );
    const gate = assessCodeql(
      JSON.parse(fs.readFileSync(path.join(reports, 'results.sarif'), 'utf8')),
      JSON.parse(fs.readFileSync(path.join(source, 'scan-source.json'), 'utf8')),
    );
    fs.writeFileSync(path.join(reports, 'gate.json'), JSON.stringify(gate) + '\n');

    if (!gate.passed) {
      throw Error('codeql-findings');
    }
  }
}
