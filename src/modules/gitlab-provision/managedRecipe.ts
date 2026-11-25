import { createHash } from 'node:crypto';
import type { GitlabActivationSession } from './sourcePrimaryActivation.service';
export type RecipeRow = Record<string, unknown>;
export const managedCiPath = '.system-bootstrapper/ci.yml';
export function recipeRow(value: unknown): RecipeRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('Invalid managed Wizard recipe input');
  }

  return value as RecipeRow;
}
export function recipeText(value: unknown): string {
  if (typeof value !== 'string') {
    throw Error('Invalid managed Wizard recipe input');
  }

  return value;
}
export function recipeFiles(value: unknown): RecipeRow[] {
  if (!Array.isArray(value)) {
    throw Error('Invalid managed Wizard recipe files');
  }

  return value.map(recipeRow);
}
export function ensureRecipe(value: unknown, message: string): asserts value {
  if (!value) {
    throw Error(message);
  }
}
export function decodedRecipe(value: RecipeRow): string {
  const content = recipeText(value.content).replace(/\n/g, ''),
    bytes = Buffer.from(content, 'base64');
  ensureRecipe(bytes.toString('base64') === content, 'Invalid managed Wizard file encoding');
  return bytes.toString('utf8');
}
export function advisoryKey(value: string): string {
  return BigInt('0x' + createHash('sha256').update(value).digest('hex').slice(0, 15)).toString();
}
export function managedOwnership(input: RecipeRow, project: RecipeRow): void {
  const repository = recipeRow(input.repository);
  ensureRecipe(
    project.id === repository.id &&
      project.visibility === 'private' &&
      project.description === 'System Bootstrapper operation ' + input.operation &&
      project.path_with_namespace === repository.path &&
      project.default_branch === repository.defaultBranch &&
      project.ci_config_path === managedCiPath,
    'Wizard repository ownership changed',
  );
}
export function sourceMarker(input: RecipeRow): string {
  const workflow = recipeRow(input.workflow);
  return JSON.stringify({
    version: 1,
    operation: input.operation,
    sourceRevision: workflow.sourceRevision,
    manifestHash: workflow.manifestHash,
    ...(workflow.sourceLayout
      ? { sourceLayout: workflow.sourceLayout, wizardSourceTree: workflow.wizardSourceTree }
      : {}),
  });
}
/** Repository reads are shared; operation services decide ownership and mutation policy. */
export class ManagedRecipeRepository {
  readonly prefix: string;
  constructor(
    readonly session: GitlabActivationSession,
    readonly project: RecipeRow,
  ) {
    this.prefix = `projects/${project.id}/`;
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    body?: RecipeRow,
    expected = 200,
  ): Promise<unknown> {
    const result = await this.session.request(method, this.prefix + path, body);
    ensureRecipe(
      result.status === expected,
      'Managed Wizard GitLab request failed; refresh the same operation',
    );
    return result.value;
  }

  async file(name: string): Promise<RecipeRow | undefined> {
    const response = await this.session.request(
      'GET',
      this.prefix +
        'repository/files/' +
        encodeURIComponent(name) +
        '?ref=' +
        encodeURIComponent(recipeText(this.project.default_branch)),
    );
    ensureRecipe([200, 404].includes(response.status), 'Managed Wizard file lookup failed');
    return response.status === 200 ? recipeRow(response.value) : undefined;
  }

  async matching(name: string, expected: string, commit?: string): Promise<RecipeRow> {
    const file = await this.file(name);
    ensureRecipe(
      file && decodedRecipe(file) === expected && (!commit || file.last_commit_id === commit),
      'Managed environment content changed; refusing overwrite',
    );
    return file;
  }

  async head(): Promise<string> {
    const result = recipeRow(
      await this.request(
        'GET',
        'repository/branches/' + encodeURIComponent(recipeText(this.project.default_branch)),
      ),
    );
    const head = recipeText(recipeRow(result.commit).id);
    ensureRecipe(/^[a-f0-9]{40}$/.test(head), 'Invalid Wizard branch identity');
    return head;
  }

  async parent(commit: string, parent: string): Promise<void> {
    const installed = recipeRow(await this.request('GET', 'repository/commits/' + commit));
    ensureRecipe(
      Array.isArray(installed.parent_ids) &&
        installed.parent_ids.length === 1 &&
        installed.parent_ids[0] === parent,
      'Wizard branch raced recipe installation; inspect the existing commit',
    );
  }
}
