'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const application = require('../e2e/application-routing');
function fixture(change = value => value) {
  const requests = [], controls = [], candidate = {spec: {}, wait: async action => assert(await action())};
  const probe = async (_, host, route) => {
    requests.push({host, route});
    return change(route.includes('acme-challenge') ? {status: 200, body: 'application-http01-proof', headers: {}} :
      {status: 308, headers: {location: 'https://' + application.APP_HOST + route}, serial: 'current'});
  };
  const dependencies = {tlsProbe: probe, httpProbe: probe, controller: async (_, action, input) => controls.push({action: String(action), input}),
    session: async () => ({request: async route => {assert.equal(route, '/config/projects');return [{filename: '.' + application.PROJECT + '.env',
      data: ' '.repeat(807) + '$\nPROD_ALIASES="' + application.APP_ALIAS + '"', repository: {id: 42}}];}})};
  return {candidate, dependencies, requests, controls};
}
test('candidate application verification covers both protocols, exact encoded query, direct challenge, serial and authenticated ownership Fetch', async () => {
  const f = fixture();await application.verify(f.candidate, {serial: 'current'}, f.dependencies);
  assert.equal(f.requests.length, 4);
  assert(f.requests.every(request => request.host === application.APP_ALIAS));
  assert(f.requests.some(request => request.route.includes('?one=1&two=a%2Fb&one=2')));
  assert.equal(f.controls.length, 2);assert.match(f.controls.at(-1).action, /rmSync/);
  assert.equal(f.candidate.applicationAliasesVerified, true);
});
test('changed canonical redirect, missing query, stale certificate and redirecting HTTP01 fail acceptance', async () => {
  for (const change of [value => value.status === 308 ? {...value, headers: {location: 'https://other.example.test/'}} : value,
    value => value.status === 308 ? {...value, headers: {location: value.headers.location.split('?')[0]}} : value,
    value => ({...value, serial: 'stale'}), value => value.status === 200 ? {...value, headers: {location: '/'}} : value]) {
    const f = fixture(change);
    await assert.rejects(() => application.verify(f.candidate, {serial: 'current'}, f.dependencies), /application-alias-(redirect|http01)-failed/);
    assert.notEqual(f.candidate.applicationAliasesVerified, true);assert.equal(f.controls.length, 2);
  }
});
test('selective candidate Push must retain every previous container ID, image, start time and restart count', () => {
  const before = {'/system_gitlab_1': {id: 'gitlab', image: 'gitlab-image', started: 'earlier', restarts: 0},
    '/application-routing-prod': {id: 'production', image: 'application-image', started: 'earlier', restarts: 0}};
  application.assertPreserved(before, {...before, '/routingproof_review_1': {id: 'new-review-proxy'}});
  for (const key of ['id', 'image', 'started', 'restarts'])
    assert.throws(() => application.assertPreserved(before, {...before, '/system_gitlab_1': {...before['/system_gitlab_1'], [key]: 'changed'}}), /existing-container-changed/);
});
