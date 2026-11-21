import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { GitlabApiResult } from './native-api.service';
type Row = Record<string, unknown>;
export interface RecipeReadPort {
  (route: string): Promise<GitlabApiResult>;
}
function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('gitlab-recipe-proof-invalid');
  return value as Row;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw Error('gitlab-recipe-proof-invalid');
  return value;
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const commit = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
function paths(value: unknown): Row[] {
  if (!Array.isArray(value) || !value.length || value.length > 100)
    throw Error('gitlab-recipe-proof-invalid');
  const files = value.map(row);
  if (
    new Set(files.map((file) => file.path)).size !== files.length ||
    files.some(
      (file) =>
        typeof file.path !== 'string' ||
        !file.path.startsWith('.system-bootstrapper/') ||
        file.path.split('/').some((part) => ['', '.', '..'].includes(part)) ||
        /[\0\r\n\\]/.test(file.path) ||
        typeof file.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(file.sha256),
    )
  )
    throw Error('gitlab-recipe-proof-invalid');
  return files;
}
/** Store bounded hashes rather than complete recipe sources in the private operation journal. */
export async function recipeWriteProof(
  projectId: number,
  route: string,
  body: Row,
  get: RecipeReadPort,
): Promise<Row> {
  const prefix = `projects/${projectId}/`;
  if (route === prefix + 'repository/commits') {
    if (!Array.isArray(body.actions)) throw Error('gitlab-recipe-proof-invalid');
    const files = body.actions.map((value) => {
      const action = row(value);
      if (
        !['create', 'update'].includes(String(action.action)) ||
        action.encoding !== undefined ||
        (action.action === 'update' && !commit(action.last_commit_id))
      )
        throw Error('gitlab-recipe-proof-invalid');
      return { path: text(action.file_path), sha256: sha(text(action.content)) };
    });
    paths(files);
    const branch = text(body.branch),
      result = await get(prefix + 'repository/branches/' + encodeURIComponent(branch));
    const parent = row(row(result.value).commit).id;
    if (result.status !== 200 || !commit(parent)) throw Error('gitlab-recipe-parent-invalid');
    return { kind: 'commit', branch, parent, files };
  }
  if (route === prefix + 'pipeline') {
    if (!Array.isArray(body.variables) || body.variables.length !== 2)
      throw Error('gitlab-recipe-proof-invalid');
    const variables = body.variables.map(row),
      operation = variables.find((v) => v.key === 'SYSTEM_WIZARD_OPERATION')?.value,
      expected = variables.find((v) => v.key === 'SYSTEM_WIZARD_EXPECTED_SHA')?.value;
    if (typeof operation !== 'string' || !/^[a-f0-9]{48}$/.test(operation) || !commit(expected))
      throw Error('gitlab-recipe-proof-invalid');
    return { kind: 'pipeline', branch: text(body.ref), operation, commit: expected };
  }
  throw Error('gitlab-recipe-write-route-invalid');
}
export function validateRecipeProof(value: Row): void {
  if (typeof value.branch !== 'string' || !value.branch || /[\0\r\n]/.test(value.branch))
    throw Error('gitlab-recipe-proof-invalid');
  if (value.kind === 'commit') {
    if (!commit(value.parent)) throw Error('gitlab-recipe-proof-invalid');
    paths(value.files);
  } else if (value.kind === 'pipeline') {
    if (
      !commit(value.commit) ||
      typeof value.operation !== 'string' ||
      !/^[a-f0-9]{48}$/.test(value.operation)
    )
      throw Error('gitlab-recipe-proof-invalid');
  } else throw Error('gitlab-recipe-proof-invalid');
}
/** Missing evidence remains ambiguous: callers may inspect status but cannot issue another write. */
export async function reconcileRecipeWrite(
  projectId: number,
  proof: Row,
  read: RecipeReadPort,
): Promise<boolean> {
  validateRecipeProof(proof);
  const deadline = Date.now() + 60000;
  const get: RecipeReadPort = (route) => {
    if (Date.now() >= deadline) throw Error('gitlab-recipe-reconciliation-budget-exceeded');
    return read(route);
  };
  const prefix = `projects/${projectId}/`;
  if (proof.kind === 'commit') {
    let installed: string | undefined;
    for (const file of paths(proof.files)) {
      const response = await get(
        prefix +
          'repository/files/' +
          encodeURIComponent(text(file.path)) +
          '?ref=' +
          encodeURIComponent(text(proof.branch)),
      );
      if (response.status === 404) return false;
      const current = row(response.value),
        bytes = Buffer.from(text(current.content).replace(/\n/g, ''), 'base64');
      if (
        response.status !== 200 ||
        createHash('sha256').update(bytes).digest('hex') !== file.sha256 ||
        !commit(current.last_commit_id) ||
        (installed && installed !== current.last_commit_id)
      )
        throw Error('gitlab-recipe-commit-reconciliation-conflict');
      installed = text(current.last_commit_id);
    }
    const response = await get(prefix + 'repository/commits/' + installed);
    if (
      response.status !== 200 ||
      !isDeepStrictEqual(row(response.value).parent_ids, [proof.parent])
    )
      throw Error('gitlab-recipe-parent-reconciliation-conflict');
    return true;
  }
  let matches = 0,
    inspected = 0;
  for (let page = 1; page <= 20; page++) {
    const response = await get(
      prefix +
        'pipelines?ref=' +
        encodeURIComponent(text(proof.branch)) +
        '&sha=' +
        text(proof.commit) +
        '&source=api&per_page=100&page=' +
        page,
    );
    if (response.status !== 200 || !Array.isArray(response.value))
      throw Error('gitlab-recipe-pipeline-reconciliation-failed');
    for (const item of response.value) {
      if (++inspected > 20) throw Error('gitlab-recipe-pipeline-reconciliation-limit');
      const pipeline = row(item);
      if (!Number.isSafeInteger(pipeline.id) || Number(pipeline.id) < 1)
        throw Error('gitlab-recipe-pipeline-reconciliation-failed');
      const vars = await get(prefix + 'pipelines/' + pipeline.id + '/variables');
      if (vars.status !== 200 || !Array.isArray(vars.value))
        throw Error('gitlab-recipe-pipeline-reconciliation-failed');
      if (
        !vars.value.some((value) => {
          const variable = row(value);
          return variable.key === 'SYSTEM_WIZARD_OPERATION' && variable.value === proof.operation;
        })
      )
        continue;
      if (
        pipeline.sha !== proof.commit ||
        pipeline.ref !== proof.branch ||
        pipeline.source !== 'api' ||
        ++matches > 1
      )
        throw Error('gitlab-recipe-pipeline-reconciliation-conflict');
    }
    if (response.value.length < 100) return matches === 1;
  }
  throw Error('gitlab-recipe-pipeline-reconciliation-limit');
}
