'use strict';
// Independent read-only oracle for the small, explicitly owned candidate.
// Keep the production CLI's Rails-based sample independent from these REST
// reads, including after offline recovery and a separate controller restart.
const crypto = require('node:crypto');
function requireValue(value) {
  if (!value) throw Error('public-upgrade-data-inventory-invalid');
}
const positive = value => Number.isSafeInteger(value) && value > 0;
async function inventory(candidate, token, endpoint) {
  const result = [], seen = new Set();
  for (let page = 1; page <= 10; page++) {
    const rows = await candidate.api(endpoint + (endpoint.includes('?') ? '&' : '?') + 'per_page=100&page=' + page, token);
    requireValue(Array.isArray(rows) && rows.length <= 100);
    for (const row of rows) {
      requireValue(row && positive(row.id) && !seen.has(row.id));
      seen.add(row.id); result.push(row);
    }
    if (rows.length < 100) return result.sort((left, right) => left.id - right.id);
  }
  throw Error('public-upgrade-data-inventory-limit');
}
async function sample(candidate, auth) {
  requireValue(auth && typeof auth.token === 'string' && auth.token.length > 0);
  const user = await candidate.api('/user', auth.token);
  requireValue(user.is_admin === true && user.id === auth.root_id);
  const projects = await inventory(candidate, auth.token, '/projects?order_by=id&sort=asc');
  // This is a disposable-fixture oracle, never an unbounded instance crawler.
  requireValue(projects.length > 0 && projects.length <= 40);
  const projectRows = [], registries = [];
  for (const project of projects) {
    requireValue(typeof project.path_with_namespace === 'string' && project.path_with_namespace.length > 0);
    if (projectRows.length < 10) {
      requireValue(typeof project.empty_repo === 'boolean');
      let head = null;
      if (!project.empty_repo) {
        requireValue(typeof project.default_branch === 'string' && project.default_branch.length > 0);
        const branch = await candidate.api('/projects/' + project.id + '/repository/branches/' + encodeURIComponent(project.default_branch), auth.token);
        requireValue(/^[a-f0-9]{40}$/.test(branch?.commit?.id || ''));
        head = branch.commit.id;
      }
      projectRows.push([project.id, project.path_with_namespace, head]);
    }
    for (const repository of await inventory(candidate, auth.token, '/projects/' + project.id + '/registry/repositories')) {
      requireValue(repository.project_id === project.id && typeof repository.name === 'string');
      registries.push([repository.id, repository.project_id, repository.name]);
    }
  }
  requireValue(new Set(registries.map(row => row[0])).size === registries.length);
  const users = (await inventory(candidate, auth.token, '/users?order_by=id&sort=asc')).slice(0, 10).map(row => {
    requireValue(typeof row.username === 'string' && row.username.length > 0);
    return [row.id, row.username];
  });
  const issueRows = await inventory(candidate, auth.token, '/issues?scope=all&state=all&non_archived=false');
  const reviewRows = await inventory(candidate, auth.token, '/merge_requests?scope=all&state=all');
  const tuple = (row, field) => {
    requireValue(positive(row[field]) && positive(row.iid));
    return [row.id, row[field], row.iid];
  };
  const values = {projects: projectRows, users, issues: issueRows.slice(0, 10).map(row => tuple(row, 'project_id')),
    mergeRequests: reviewRows.slice(0, 10).map(row => tuple(row, 'target_project_id')),
    registries: registries.sort((left, right) => left[0] - right[0]).slice(0, 10)};
  return {format: 'system-upgrade-rest-data-sample-v1',
    sha256: crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex'),
    sampledProjects: projectRows.length,
    scope: 'up-to-ten-existing-records-per-kind-and-project-repository-heads'};
}
module.exports = {inventory, sample};
