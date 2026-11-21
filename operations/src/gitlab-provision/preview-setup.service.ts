import { Injectable } from '@nestjs/common';
import { GitlabCredentialService } from './credential.service';
import { GitlabNativeApiService, type GitlabMethod } from './native-api.service';
import {
  PreviewEvidence,
  PreviewError,
  type PreviewRow,
  previewRow,
  previewRows,
  previewText,
  previewEncode,
  requirePreview,
  previewRequestFailure,
} from './preview-evidence';
type Request = (
  method: GitlabMethod,
  route: string,
  body?: unknown,
  missing?: boolean,
) => Promise<unknown>;
@Injectable()
export class PreviewSetupService {
  constructor(
    private readonly credentials: GitlabCredentialService,
    private readonly api: GitlabNativeApiService,
  ) {}
  async execute(checkout: string, value: unknown, signal?: AbortSignal): Promise<PreviewRow> {
    let mutated = false;
    try {
      const input = previewRow(value),
        action = previewText(input.action).replace(/^preview-setup-/, '');
      requirePreview(
        [
          'preflight',
          'project',
          'revoke',
          'read',
          'read-many',
          'source-context',
          'source-evidence',
          'adoption-evidence',
          'system',
        ].includes(action),
        'Unsupported native preview setup action.',
      );
      if (action === 'system')
        throw new PreviewError('System Review setup is retired. Configure optional System Beta.');
      if (['project', 'revoke'].includes(action))
        requirePreview(
          typeof input.operation === 'string' &&
            input.operation.length > 0 &&
            input.operation.length <= 256 &&
            !/[\r\n\0]/.test(input.operation),
        );
      // Validate complete independent read batches before credential acquisition or API access.
      const validate = new PreviewEvidence(input, async () => undefined);
      if (action === 'read') validate.routes([input.route]);
      if (action === 'read-many') validate.routes(input.routes);
      const authority = await this.credentials.ensure({ checkout, signal });
      const request: Request = async (method, route, body, missing = false) => {
        signal?.throwIfAborted();
        if (method !== 'GET') mutated = true;
        const result = await this.api.request(
          authority.context,
          authority.credential.token,
          method,
          route,
          body,
        );
        if (missing && result.status === 404) return null;
        requirePreview([200, 201, 204].includes(result.status), previewRequestFailure);
        return result.value;
      };
      const evidence = new PreviewEvidence(input, (route) => request('GET', route));
      if (action === 'read') return { value: await evidence.read(previewText(input.route)) };
      if (action === 'read-many') {
        const values: unknown[] = [];
        for (const route of evidence.routes(input.routes)) values.push(await evidence.read(route));
        return { values };
      }
      if (action === 'source-context') return await evidence.context();
      if (action === 'source-evidence') return await evidence.source();
      if (action === 'adoption-evidence') return await evidence.adoption();
      const marker = 'System Bootstrapper preview setup ' + input.operation;
      const owned = (project: PreviewRow) =>
        requirePreview(
          project.description === marker && project.visibility === 'private',
          'Preview source ownership changed; existing operator projects are never overwritten.',
        );
      if (action === 'revoke') {
        requirePreview(
          Number.isSafeInteger(input.projectId) &&
            Number(input.projectId) > 0 &&
            Number.isSafeInteger(input.tokenId) &&
            Number(input.tokenId) > 0,
        );
        const project = previewRow(await request('GET', `projects/${input.projectId}`));
        owned(project);
        requirePreview(project.id === input.projectId);
        await request('DELETE', `projects/${project.id}/access_tokens/${input.tokenId}`);
        return { revoked: true };
      }
      const selected = previewRows(await request('GET', 'namespaces?per_page=100')).find(
        (row) => row.full_path === input.namespace,
      );
      requirePreview(selected, 'The selected namespace is missing or inaccessible.');
      const lookup = async (source: PreviewRow) =>
        request(
          'GET',
          'projects/' +
            previewEncode(previewText(selected.full_path) + '/' + previewText(source.project)),
          undefined,
          true,
        );
      if (action === 'preflight') {
        const available = await this.runners(request, 'runners/all?per_page=100&status=online');
        const tags =
          input.sourceLayout === 'system-monorepo-v1'
            ? ['docker']
            : ['docker', 'wizard-source-primary'];
        requirePreview(
          available.some((row) => this.tags(row, tags)),
          'An online Docker runner with source access is required.',
        );
        const projects: PreviewRow[] = [];
        for (const source of previewRows(input.sources)) {
          const value = await lookup(source),
            project = value ? previewRow(value) : null;
          if (source.mode === 'import') {
            requirePreview(
              !project || project.description === marker,
              'The selected import project is occupied. Choose a new project or explicitly select an existing source.',
            );
            continue;
          }
          this.existing(
            project,
            source,
            'Select an existing private source with its native CI and merge gates enabled.',
          );
          let sourceRevision: unknown = null;
          if (input.sourceLayout === 'system-monorepo-v1') {
            const branch = previewRow(
              await request(
                'GET',
                `projects/${project.id}/repository/branches/` +
                  previewEncode(project.default_branch),
              ),
            );
            const sha = previewRow(branch.commit).id;
            requirePreview(
              branch.protected === true &&
                typeof sha === 'string' &&
                sha.length === 40 &&
                /^[a-f0-9]+$/.test(sha),
              'Protect the shared System default branch.',
            );
            const tree = previewRows(
              await request(
                'GET',
                `projects/${project.id}/repository/tree?ref=${sha}&per_page=100`,
              ),
            );
            requirePreview(
              tree.some(
                (row) => row.path === 'wizard' && row.type === 'tree' && row.mode === '040000',
              ),
              'The selected System source must contain the regular Wizard tree.',
            );
            sourceRevision = sha;
          }
          projects.push({
            id: project.id,
            path: project.path_with_namespace,
            namespaceId: previewRow(project.namespace).id,
            defaultBranch: project.default_branch,
            sourceRevision,
          });
          requirePreview(
            (await this.runners(request, `projects/${project.id}/runners?per_page=100`)).some(
              (row) => this.tags(row, ['docker']),
            ),
            'The selected source project has no online permitted Docker runner.',
          );
        }
        return {
          namespaceId: selected.id,
          runnerReady: true,
          ...(input.sourceLayout === 'system-monorepo-v1' ? { projects } : {}),
        };
      }
      const source = previewRow(input.source);
      let projectValue = await lookup(source);
      if (source.mode === 'import' && !projectValue)
        projectValue = await request('POST', 'projects', {
          name: source.project,
          path: source.project,
          namespace_id: selected.id,
          visibility: 'private',
          description: marker,
          initialize_with_readme: false,
          auto_devops_enabled: false,
          ci_config_path: source.ciPath,
          only_allow_merge_if_pipeline_succeeds: true,
          only_allow_merge_if_all_discussions_are_resolved: true,
        });
      const project = projectValue ? previewRow(projectValue) : null;
      if (source.mode === 'import') {
        requirePreview(project);
        owned(project);
        for (const key of [
          'GITHUB_BACKUP_ENABLED',
          'DOCKERHUB_PUBLISH_ENABLED',
          'GITHUB_RELEASE_PUBLISH_ENABLED',
          'WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED',
        ])
          await this.variable(request, project, key, 'false');
      } else
        this.existing(project, source, 'Existing source identity or native merge gates changed.');
      requirePreview(project);
      const tags =
        source.ciPath === '.gitlab/primary.yml' ? ['docker', 'wizard-source-primary'] : ['docker'];
      requirePreview(
        (await this.runners(request, `projects/${project.id}/runners?per_page=100`)).some((row) =>
          this.tags(row, tags),
        ),
        'The selected project has no permitted online runner for its native checks.',
      );
      if (source.ciPath === '.gitlab/primary.yml')
        await this.variable(request, project, 'WIZARD_DELIVERY_ENABLED', 'true');
      if (source.mode !== 'import') return { project };
      const tomorrow = new Date();
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const token = previewRow(
        await request('POST', `projects/${project.id}/access_tokens`, {
          name: 'bootstrapper-preview-source-' + input.operation,
          scopes: ['write_repository'],
          access_level: 40,
          expires_at: tomorrow.toISOString().slice(0, 10),
        }),
      );
      requirePreview(
        Number.isSafeInteger(token.id) && typeof token.token === 'string' && token.token.length > 0,
        previewRequestFailure,
      );
      return { project, credential: { id: token.id, token: token.token } };
    } catch (error) {
      if (error instanceof PreviewError) return { state: 'failed', message: error.message };
      if (
        mutated ||
        (error && typeof error === 'object' && 'uncertain' in error && error.uncertain === true)
      )
        throw Object.assign(Error(previewRequestFailure), { uncertain: true });
      return { state: 'failed', message: previewRequestFailure };
    }
  }
  private existing(
    project: PreviewRow | null | unknown,
    source: PreviewRow,
    message: string,
  ): asserts project is PreviewRow {
    requirePreview(project, message);
    const row = previewRow(project);
    requirePreview(
      row.visibility === 'private' &&
        (row.ci_config_path === source.ciPath ||
          (source.ciPath === '.gitlab-ci.yml' && row.ci_config_path == null)) &&
        row.only_allow_merge_if_pipeline_succeeds === true &&
        row.only_allow_merge_if_all_discussions_are_resolved === true,
      message,
    );
  }
  private tags(row: PreviewRow, tags: string[]): boolean {
    return (
      row.paused === false &&
      row.status === 'online' &&
      Array.isArray(row.tag_list) &&
      tags.every((tag) => (row.tag_list as unknown[]).includes(tag))
    );
  }
  private async runners(request: Request, route: string): Promise<PreviewRow[]> {
    const result: PreviewRow[] = [];
    for (const row of previewRows(await request('GET', route)).filter(
      (row) => row.paused === false && row.status === 'online',
    ))
      result.push(previewRow(await request('GET', `runners/${row.id}`)));
    return result;
  }
  private async variable(
    request: Request,
    project: PreviewRow,
    key: string,
    value: string,
  ): Promise<void> {
    const prefix = `projects/${project.id}/variables`,
      current = await request(
        'GET',
        prefix + '/' + key + '?filter%5Benvironment_scope%5D=*',
        undefined,
        true,
      );
    if (current) {
      const row = previewRow(current);
      requirePreview(
        row.value === value &&
          row.environment_scope === '*' &&
          row.raw === true &&
          row.protected === false &&
          row.masked === false,
        'A preview setup variable conflicts with operator settings.',
      );
    } else
      await request('POST', prefix, {
        key,
        value,
        environment_scope: '*',
        raw: true,
        protected: false,
        masked: false,
      });
  }
}
