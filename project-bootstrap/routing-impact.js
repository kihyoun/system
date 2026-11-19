#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const routing = require('../nginx/wizard-aliases');
const application = require('../nginx/application-aliases');
const {managed} = require('./preserve-system-project');
const routeKey = /^(?:USE_(?:PROD|BETA|REVIEW)_HOST|(?:PROD|BETA|REVIEW)_(?:HOST|DOMAIN_MODE|DEPLOY_MODE|SSL|SSL_KEY|ALIASES))$/;
function semantic(content) {
  routing.signature(content);
  const values = routing.settings(content, new Set(routing.records(content).map(record => record.key)));
  return {values, ownership: content.split('\n').filter(line => /^# BOOTSTRAPPER_(?:PROJECT|REPOSITORY)=/.test(line))};
}
function mainSemantic(content) {
  const result = semantic(content);
  // The established Wizard export omits inactive TLS fields. Their omission
  // must not turn an ordinary HTTP installation's routing edit into downtime.
  for (const prefix of ['GITLAB', 'GITLAB_REGISTRY', 'SYNC', 'WIZARD'])
    if (['0', '1'].includes(result.values[prefix + '_DOMAIN_MODE']) && !(prefix === 'WIZARD' && result.values.WIZARD_ALIASES?.trim())) {
      delete result.values[prefix + '_SSL']; delete result.values[prefix + '_SSL_KEY'];
    }
  return result;
}
const stable = value => JSON.stringify(value, (_, item) => item && !Array.isArray(item) && typeof item === 'object'
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
function impact(archive, current) {
  const incoming = application.imported(archive, current);
  const previousMain = path.join(current, '.docker.env');
  const previous = routing.projectFiles(path.join(current, '.projects.env'));
  const snapshot = {main: fs.existsSync(previousMain) ? fs.readFileSync(previousMain, 'utf8') : '', projects: previous};
  const extraFiles = fs.readdirSync(archive).filter(name => name.endsWith('.env') && name !== '.docker.env' && name !== '.projects.env').sort()
    .map(name => ({name, incoming: fs.readFileSync(path.join(archive, name), 'utf8'),
      previous: fs.existsSync(path.join(current, name)) ? fs.readFileSync(path.join(current, name), 'utf8') : null}));
  let mode = 'restart', projects = [];
  try {
    if (extraFiles.some(file => file.incoming !== file.previous)) throw Error('Additional configuration changed.');
    const oldMain = mainSemantic(snapshot.main), newMain = mainSemantic(incoming.main);
    if (stable(oldMain) !== stable(newMain)) throw Error('Main settings changed.');
    if (stable(previous.map(file => file.name)) !== stable(incoming.projects.map(file => file.name).sort())) throw Error('Project set changed.');
    for (const file of incoming.projects) {
      const old = previous.find(item => item.name === file.name);
      const before = semantic(old.content), after = semantic(file.content);
      if (stable(before) === stable(after)) continue;
      if (managed(old.content) || before.values.PROJECT_TEMPLATE === 'wizard' ||
          before.values.PROJECT_NAME !== after.values.PROJECT_NAME || !/^[a-z0-9]+$/.test(after.values.PROJECT_NAME) ||
          file.name !== '.' + after.values.PROJECT_NAME + '.env' || stable(before.ownership) !== stable(after.ownership)) throw Error('Project ownership changed.');
      const changed = new Set([...Object.keys(before.values), ...Object.keys(after.values)]);
      for (const key of changed) if (before.values[key] !== after.values[key] && !routeKey.test(key)) throw Error('Non-routing project settings changed.');
      projects.push(after.values.PROJECT_NAME);
    }
    mode = projects.length ? 'routing' : 'none';
  } catch (_) { projects = []; }
  const normalized = state => {
    try { return {main: semantic(state.main), projects: state.projects.map(file => ({name: file.name, data: semantic(file.content)})).sort((a, b) => a.name.localeCompare(b.name))}; }
    catch (_) { return state; }
  };
  const fingerprint = crypto.createHash('sha256').update(stable({previous: normalized(snapshot), incoming: normalized(incoming), extraFiles})).digest('hex');
  return {mode, projects: projects.sort(), fingerprint};
}
module.exports = {semantic, impact};
if (require.main === module) {
  try { const result = impact(process.argv[2], process.argv[3]); process.stdout.write(process.argv[4] === 'mode' ? result.mode : JSON.stringify(result)); }
  catch (error) { console.error('Configuration impact: ' + error.message); process.exitCode = 1; }
}
