'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {inventory, sample} = require('../e2e/public-upgrade-data');

function fixture() {
  const records = {
    '/user': {id: 1, is_admin: true},
    '/projects': [{id: 2, path_with_namespace: 'test/empty', empty_repo: true},
      {id: 1, path_with_namespace: 'test/source', empty_repo: false, default_branch: 'main/source'}],
    '/projects/1/repository/branches/main%2Fsource': {commit: {id: 'a'.repeat(40)}},
    '/projects/1/registry/repositories': [{id: 2, project_id: 1, name: 'image'}],
    '/projects/2/registry/repositories': [{id: 1, project_id: 2, name: ''}],
    '/users': [{id: 2, username: 'other'}, {id: 1, username: 'root'}],
    '/issues': [{id: 3, project_id: 2, iid: 1}, {id: 1, project_id: 1, iid: 2}],
    '/merge_requests': [{id: 2, target_project_id: 2, iid: 1}, {id: 1, target_project_id: 1, iid: 1}]
  };
  const calls = [], auth = {token: 'private-fixture-token', root_id: 1};
  const candidate = {api: async (endpoint, token, method) => {
    assert.equal(token, auth.token); assert.equal(method, undefined); calls.push(endpoint);
    const url = new URL(endpoint, 'https://candidate.invalid');
    if (['/issues', '/merge_requests'].includes(url.pathname)) {
      assert.equal(url.searchParams.get('scope'), 'all'); assert.equal(url.searchParams.get('state'), 'all');
    }
    if (url.pathname === '/issues') assert.equal(url.searchParams.get('non_archived'), 'false',
      'archived project issues remain part of the original broad data sample');
    const rows = records[url.pathname]; assert.notEqual(rows, undefined);
    if (!Array.isArray(rows)) return rows;
    assert.equal(url.searchParams.get('per_page'), '100');
    const page = Number(url.searchParams.get('page'));
    return rows.slice((page - 1) * 100, page * 100);
  }};
  return {records, calls, auth, candidate};
}
test('REST oracle retains broad data coverage and stable ID ordering without any Rails startup', async () => {
  const f = fixture(), before = await sample(f.candidate, f.auth);
  for (const rows of Object.values(f.records)) if (Array.isArray(rows)) rows.reverse();
  assert.deepEqual(await sample(f.candidate, f.auth), before);
  assert.equal(before.sampledProjects, 2);
  assert.match(before.sha256, /^[a-f0-9]{64}$/);
  const mutations = [
    () => { f.records['/projects/1/repository/branches/main%2Fsource'].commit.id = 'b'.repeat(40); },
    () => { f.records['/projects'][0].path_with_namespace += '-changed'; },
    () => { f.records['/users'][0].username += '-changed'; },
    () => { f.records['/issues'][0].iid += 1; },
    () => { f.records['/merge_requests'][0].target_project_id += 1; },
    () => { f.records['/projects/1/registry/repositories'][0].name += '-changed'; }
  ];
  let previous = before;
  for (const mutate of mutations) {
    mutate(); const next = await sample(f.candidate, f.auth);
    assert.notDeepEqual(next, previous); previous = next;
  }
});
test('pagination finds lower IDs beyond first page and refuses duplicates, overflow and malformed data', async () => {
  const f = fixture();
  f.records['/issues'] = Array.from({length: 101}, (_, index) => ({id: 101 - index, project_id: 1, iid: 101 - index}));
  const before = await sample(f.candidate, f.auth);
  assert(f.calls.includes('/issues?scope=all&state=all&non_archived=false&per_page=100&page=2'));
  f.records['/issues'][100].iid += 1;
  assert.notDeepEqual(await sample(f.candidate, f.auth), before);
  f.records['/issues'][100].id = 101;
  await assert.rejects(sample(f.candidate, f.auth), /inventory-invalid/);
  await assert.rejects(inventory({api: async endpoint => {
    const page = Number(new URL(endpoint, 'https://candidate.invalid').searchParams.get('page'));
    return Array.from({length: 100}, (_, index) => ({id: page * 100 + index + 1}));
  }}, 'test', '/issues'), /inventory-limit/);
  for (const invalid of [null, {}, [{id: -1}], [{id: 1}, {id: 1}]])
    await assert.rejects(inventory({api: async () => invalid}, 'test', '/issues'), /inventory-invalid/);
});
test('oracle refuses partial visibility, foreign registry ownership, unknown heads and oversized fixtures', async () => {
  for (const mutate of [
    f => { f.records['/user'].is_admin = false; },
    f => { f.records['/user'].id = 2; },
    f => { f.records['/projects/1/registry/repositories'][0].project_id = 2; },
    f => { f.records['/projects/1/repository/branches/main%2Fsource'].commit.id = null; },
    f => { delete f.records['/projects'][1].empty_repo; },
    f => { f.records['/projects'] = Array.from({length: 41}, (_, i) => ({id: i + 1})); }
  ]) {
    const f = fixture(); mutate(f);
    await assert.rejects(sample(f.candidate, f.auth), /inventory-invalid/);
  }
});
