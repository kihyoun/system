import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { operationSignals } from '../host/operation-cancellation';
import { LiveAuditModule } from './live-audit.module';
import { LiveProjectAuditService } from './live-project-audit.service';
import { LiveRunnerAuditService } from './live-runner-audit.service';
import { requireAudit } from './live-audit-access.service';
export async function liveAuditMain(
  mode: 'project' | 'templates' | 'runner',
  args = process.argv.slice(2),
) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      checkout: { type: 'string', default: path.resolve(__dirname, '../../..') },
      'config-directory': { type: 'string', default: '/srv/gitlab/config' },
      project: { type: 'string' },
      'projects-file': { type: 'string' },
      configuration: { type: 'string', default: '/state/.docker.env' },
      'job-image': { type: 'string' },
      'cleanup-record': { type: 'string' },
      timeout: { type: 'string', default: '720' },
      'allow-disposable-project': { type: 'boolean', default: false },
    },
  });
  requireAudit(['project', 'templates', 'runner'].includes(mode), 'mode-invalid');
  if (mode === 'project') requireAudit(values.project, 'project-required');
  if (mode === 'templates') requireAudit(values['projects-file'], 'projects-file-required');
  if (mode === 'runner')
    requireAudit(
      (values['job-image'] || values['cleanup-record']) && values['allow-disposable-project'],
      'immutable-job-image-and-disposable-project-opt-in-required',
    );
  requireAudit(!(values['cleanup-record'] && values['job-image']), 'ambiguous-runner-operation');
  let projects: unknown;
  if (mode === 'templates') {
    const filename = values['projects-file']!,
      stat = fs.lstatSync(filename);
    requireAudit(
      path.isAbsolute(filename) &&
        stat.isFile() &&
        !stat.isSymbolicLink() &&
        stat.size <= 1024 * 1024,
      'bounded-projects-file-required',
    );
    projects = JSON.parse(fs.readFileSync(filename, 'utf8'));
  }
  const app = await NestFactory.createApplicationContext(LiveAuditModule, { logger: false }),
    cancellation = operationSignals();
  try {
    const input = {
      checkout: values.checkout,
      configDirectory: values['config-directory'],
      signal: cancellation.signal,
    };
    const result =
      mode === 'project'
        ? await app.get(LiveProjectAuditService).project({ ...input, project: values.project! })
        : mode === 'templates'
          ? await app
              .get(LiveProjectAuditService)
              .templates({ ...input, projects, timeout: Number(values.timeout) })
          : values['cleanup-record']
            ? await app.get(LiveRunnerAuditService).cleanup({
                ...input,
                allowDisposableProject: values['allow-disposable-project'],
                recordFile: values['cleanup-record'],
              })
            : await app.get(LiveRunnerAuditService).execute({
                ...input,
                configuration: values.configuration,
                timeout: Number(values.timeout),
                jobImage: values['job-image']!,
                allowDisposableProject: values['allow-disposable-project'],
              });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    cancellation.close();
    await app.close();
  }
}
export function liveAuditFailure() {
  process.stderr.write(
    'Live audit stopped; inspect the selected disposable test resources and existing credential state.\n',
  );
  process.exitCode = 1;
}
