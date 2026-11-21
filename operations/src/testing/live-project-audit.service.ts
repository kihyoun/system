import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { record, positive } from '../release/source-identity';
import {
  LiveAuditAccessService,
  LiveAuditSession,
  requireAudit,
  type LiveAuditInput,
} from './live-audit-access.service';
export function auditProjectPath(value: unknown): string {
  requireAudit(
    typeof value === 'string' &&
      value.length <= 255 &&
      /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(value) &&
      value.split('/').every((part) => !['.', '..'].includes(part)),
    'project-path-invalid',
  );
  return value;
}
export function auditCube(bytes: Buffer): void {
  requireAudit(
    bytes[807] === 36 &&
      createHash('md5').update(bytes.subarray(0, 1184)).digest('hex') ===
        'bd4a8426355824593a5e21ad759830c1',
    'CI-signature-changed',
  );
}
export interface TemplateAuditInput extends LiveAuditInput {
  projects: unknown;
  timeout: number;
}
/** Read-only acceptance of generated repositories; CI lint is the only POST. */
@Injectable()
export class LiveProjectAuditService {
  constructor(readonly access: LiveAuditAccessService) {}
  async project(input: LiveAuditInput & { project: string }) {
    const path = auditProjectPath(input.project),
      session = await this.access.open(input),
      project = await this.identity(session, path);
    requireAudit(project.name === path.split('/').at(-1), 'project-name-changed');
    requireAudit(
      project.ci_config_path === '.system-bootstrapper/ci.yml',
      'managed-CI-path-changed',
    );
    const file = record(
      await session.json(
        'GET',
        `projects/${project.id}/repository/files/${encodeURIComponent(String(project.ci_config_path))}?ref=${encodeURIComponent(String(project.default_branch))}`,
      ),
    );
    requireAudit(
      file.encoding === 'base64' && typeof file.content === 'string',
      'CI-file-unavailable',
    );
    const content = Buffer.from(file.content, 'base64');
    auditCube(content);
    const lint = record(
      await session.json('POST', `projects/${project.id}/ci/lint`, {
        content: content.toString('utf8'),
      }),
    );
    requireAudit(lint.valid === true, 'CI-lint-rejected');
    await session.setupRevoked('project');
    return {
      privateRepository: true,
      uniquePath: true,
      defaultBranch: project.default_branch,
      ciValid: true,
      ciSignatureValid: true,
      setupCredentialsRevoked: true,
    };
  }
  async templates(input: TemplateAuditInput) {
    requireAudit(
      Array.isArray(input.projects) && input.projects.length > 0 && input.projects.length <= 8,
      'template-metadata-required',
    );
    const projects = input.projects.map(record),
      ids = new Set<unknown>(),
      paths = new Set<string>();
    for (const value of projects) {
      const path = auditProjectPath(value.path);
      requireAudit(
        positive(value.id) &&
          !ids.has(value.id) &&
          !paths.has(path) &&
          ['web', 'react', 'angular'].includes(String(value.template)) &&
          positive(record(value.initialPipeline).id),
        'template-metadata-invalid',
      );
      ids.add(value.id);
      paths.add(path);
    }
    requireAudit(
      Number.isInteger(input.timeout) && input.timeout >= 1 && input.timeout <= 900,
      'bounded-timeout-required',
    );
    const session = await this.access.open(input),
      deadline = Date.now() + input.timeout * 1000,
      results: Record<string, unknown>[] = [];
    for (const metadata of projects) {
      const project = await this.identity(session, String(metadata.path));
      requireAudit(project.id === metadata.id, 'template-project-identity-changed');
      const source =
        metadata.template === 'web'
          ? 'main.js'
          : metadata.template === 'react'
            ? 'src/App.tsx'
            : 'src/app/app.html';
      for (const file of ['Dockerfile', source]) {
        const value = record(
          await session.json(
            'GET',
            `projects/${project.id}/repository/files/${encodeURIComponent(file)}?ref=${encodeURIComponent(String(project.default_branch))}`,
          ),
        );
        requireAudit(
          value.file_path === file &&
            value.encoding === 'base64' &&
            typeof value.content === 'string',
          'template-source-missing',
        );
      }
      const pipelines = await session.pages(`projects/${project.id}/pipelines?source=api`),
        pipelineId = record(metadata.initialPipeline).id;
      requireAudit(
        pipelines.length === 1 && pipelines[0].id === pipelineId,
        'duplicate-or-different-initial-pipeline',
      );
      while (true) {
        const pipeline = record(
          await session.json('GET', `projects/${project.id}/pipelines/${pipelineId}`),
        );
        requireAudit(pipeline.id === pipelineId, 'pipeline-identity-changed');
        if (pipeline.status === 'success') break;
        requireAudit(
          !['failed', 'canceled', 'skipped', 'manual'].includes(String(pipeline.status)),
          'initial-template-pipeline-not-successful',
        );
        requireAudit(Date.now() < deadline, 'pipeline-timeout');
        await new Promise((resolve) => setTimeout(resolve, Math.min(3000, deadline - Date.now())));
      }
      const environments = await session.pages(`projects/${project.id}/environments`);
      requireAudit(
        environments.some((value) => value.name === 'production') &&
          environments.some(
            (value) => typeof value.name === 'string' && value.name.startsWith('review/'),
          ),
        'template-deployments-missing',
      );
      results.push({
        template: metadata.template,
        pipeline: 'success',
        uniqueInitialPipeline: true,
        productionAndReview: true,
      });
    }
    await session.setupRevoked('project');
    return results;
  }
  private async identity(session: LiveAuditSession, path: string) {
    const project = record(await session.json('GET', 'projects/' + encodeURIComponent(path)));
    requireAudit(
      positive(project.id) &&
        project.path_with_namespace === path &&
        project.path === path.split('/').at(-1) &&
        project.visibility === 'private' &&
        typeof project.default_branch === 'string' &&
        project.default_branch.length > 0,
      'private-project-identity-required',
    );
    // Resolve the immutable ID independently; GitLab owns path uniqueness.
    const byId = record(await session.json('GET', 'projects/' + project.id));
    requireAudit(
      byId.id === project.id && byId.path_with_namespace === path,
      'project-path-not-unique',
    );
    return project;
  }
}
