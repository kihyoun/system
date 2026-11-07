#!/usr/bin/env node
'use strict';
// Canonical aliases are configuration, never retained generated NGINX state.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {managed} = require('../project-bootstrap/preserve-system-project');

const aliasKeys = ['WIZARD_ALIASES', 'WIZARD_ALIAS_SSL', 'WIZARD_ALIAS_SSL_KEY'];
const routingKeys = new Set([...aliasKeys, 'WIZARD_ENABLE', 'WIZARD_HOST', 'WIZARD_DOMAIN_MODE',
  'PROJECT_NAME', 'PROJECT_TEMPLATE',
  'WIZARD_SSL', 'WIZARD_SSL_KEY', 'GITLAB_HOST', 'GITLAB_DOMAIN_MODE',
  'GITLAB_REGISTRY_HOST', 'GITLAB_REGISTRY_DOMAIN_MODE', 'SYNC_HOST', 'SYNC_DOMAIN_MODE',
  ...['PROD', 'BETA', 'REVIEW'].flatMap(prefix => ['USE_' + prefix + '_HOST', prefix + '_HOST', prefix + '_DOMAIN_MODE'])]);

function requireValue(value, message) { if (!value) throw Error(message); }
function signature(content) {
  requireValue(content[807] === '$' && crypto.createHash('md5').update(content.slice(0, 1184)).digest('hex') ===
    'bd4a8426355824593a5e21ad759830c1', 'Invalid configuration Cube signature.');
}
function literal(input) {
  let result = '', quote = '';
  const source = input.trim();
  requireValue(!source.includes('\0') && !source.startsWith('~'), 'Use literal alias routing settings.');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote === "'") { if (char === "'") quote = ''; else result += char; }
    else if (char === '\\') {
      const next = source[++i];
      requireValue(next !== undefined, 'Incomplete configuration escape.');
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) result += '\\';
      if (next !== '\n') result += next;
    } else if (char === quote) quote = '';
    else if (!quote && (char === "'" || char === '"')) quote = char;
    else if (char === '$' || char === '`') throw Error('Use literal alias routing settings without shell expansion.');
    else if (!quote && /\s/.test(char)) {
      requireValue(!source.slice(i).trim() || source.slice(i).trim().startsWith('#'), 'Unexpected configuration command.');
      break;
    } else if (!quote && /[;&|<>()]/.test(char)) throw Error('Use literal alias routing settings without shell commands.');
    else result += char;
  }
  requireValue(!quote, 'Incomplete configuration quote.');
  return result;
}

// Keep exact record offsets so the configuration helper changes only its own
// assignments, including when unrelated private values span multiple lines.
function records(content) {
  requireValue(typeof content === 'string' && content.length <= 4 * 1024 * 1024 && !content.includes('\0'), 'Invalid configuration text.');
  const result = [];
  let record = '', quote = '', escaped = false, offset = 0, start = 0;
  for (const part of content.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const line = part.endsWith('\n') ? part.slice(0, -1) : part;
    if (!record && (!line.trim() || line.trim().startsWith('#'))) { offset += part.length; continue; }
    if (!record) start = offset;
    record += part;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (escaped) { escaped = false; continue; }
      if (quote === "'") { if (char === "'") quote = ''; }
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      else if (!quote && (char === "'" || char === '"')) quote = char;
      else if (!quote && char === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    }
    offset += part.length;
    if (quote || escaped) { escaped = false; continue; }
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*?)\n?$/.exec(record);
    requireValue(match, 'Unsupported configuration assignment.');
    result.push({key: match[1], value: match[2], start, end: offset});
    record = '';
  }
  requireValue(!record, 'Incomplete configuration assignment.');
  return result;
}
function settings(content, wanted = routingKeys) {
  const selected = {};
  for (const record of records(content)) {
    if (!wanted.has(record.key)) continue;
    requireValue(!Object.hasOwn(selected, record.key), 'Duplicate alias routing assignment.');
    selected[record.key] = literal(record.value);
  }
  return selected;
}
function hostname(value) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 253 &&
    value.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)) &&
    !/^[0-9.]+$/.test(value), 'Configure exact DNS hostnames without schemes, ports, wildcards or trailing dots.');
  return value.toLowerCase();
}
function assignedHost(value, mode) {
  requireValue(/^[0-3]$/.test(mode || '0'), 'Invalid domain mode in alias routing configuration.');
  const explicitWildcard = value.startsWith('*.');
  const host = hostname(explicitWildcard ? value.slice(2) : value);
  return {host, wildcard: explicitWildcard || ['1', '3'].includes(mode)};
}
function conflicts(alias, value, mode) {
  if (!value) return false;
  const assigned = assignedHost(value, mode);
  return assigned.wildcard ? alias.endsWith('.' + assigned.host) : alias === assigned.host;
}
function certificatePath(value) {
  requireValue(typeof value === 'string' && /^\/ssl\/[A-Za-z0-9_./-]+$/.test(value) &&
    path.posix.normalize(value) === value && !value.endsWith('/'), 'Use an absolute alias certificate/key path within /ssl.');
  return value;
}
function validate(mainContent, projects = []) {
  // No alias is opt-in: retain legacy service routing and unrelated expanded
  // settings without introducing stricter domain/certificate requirements.
  if (!settings(mainContent, new Set(['WIZARD_ALIASES'])).WIZARD_ALIASES?.trim()) return {aliases: []};
  const main = settings(mainContent);
  requireValue(main.WIZARD_ENABLE === 'true', 'Enable the Wizard before configuring aliases.');
  requireValue(['0', '2'].includes(main.WIZARD_DOMAIN_MODE), 'Wizard aliases require an exact canonical host in domain mode 0 or 2.');
  const canonical = hostname(main.WIZARD_HOST);
  const aliases = main.WIZARD_ALIASES.trim().split(/\s+/).map(hostname);
  requireValue(aliases.length <= 100 && new Set(aliases).size === aliases.length, 'Configure at most 100 distinct Wizard aliases.');
  requireValue(!!main.WIZARD_ALIAS_SSL === !!main.WIZARD_ALIAS_SSL_KEY, 'Set alias certificate and key overrides together.');
  const certificate = certificatePath(main.WIZARD_ALIAS_SSL || main.WIZARD_SSL);
  const key = certificatePath(main.WIZARD_ALIAS_SSL_KEY || main.WIZARD_SSL_KEY);
  requireValue(certificate !== key, 'Use distinct alias certificate and private-key files.');
  const projectSettings = projects.map(content => settings(content));
  for (const alias of aliases) {
    requireValue(alias !== canonical, 'A Wizard alias cannot redirect to itself.');
    for (const prefix of ['GITLAB', 'GITLAB_REGISTRY', 'SYNC'])
      requireValue(!conflicts(alias, main[prefix + '_HOST'], main[prefix + '_DOMAIN_MODE']), 'A Wizard alias conflicts with an assigned platform host.');
    for (const project of projectSettings)
      for (const prefix of ['PROD', 'BETA', 'REVIEW'])
        // Managed Production is rendered from main WIZARD_* settings. Its
        // saved project row is refreshed after Push and can still name the old
        // canonical host while the operator turns that host into an alias.
        if (!(prefix === 'PROD' && project.PROJECT_NAME === 'wizard' && project.PROJECT_TEMPLATE === 'wizard') &&
          project['USE_' + prefix + '_HOST'] === 'true')
          requireValue(!conflicts(alias, project[prefix + '_HOST'], project[prefix + '_DOMAIN_MODE']), 'A Wizard alias conflicts with an enabled project host.');
  }
  return {aliases, origin: (main.WIZARD_DOMAIN_MODE === '2' ? 'https://' : 'http://') + canonical, certificate, key};
}
function projectFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(name => name.endsWith('.env') && name !== '.projects.env')
    .sort().map(name => ({name, content: fs.readFileSync(path.join(directory, name), 'utf8')}));
}
function validateFiles(mainFile, projectsDirectory) {
  return validate(fs.readFileSync(mainFile, 'utf8'), projectFiles(projectsDirectory).map(file => file.content));
}
function validateImport(archive, current) {
  const selectedMain = fs.existsSync(path.join(archive, '.docker.env')) ? archive : current;
  const projects = projectFiles(fs.existsSync(path.join(archive, '.projects.env')) ? path.join(archive, '.projects.env') : path.join(current, '.projects.env'));
  const owned = projectFiles(path.join(current, '.projects.env')).find(file => file.name === '.wizard.env' && managed(file.content));
  if (owned) {
    const index = projects.findIndex(file => file.name === owned.name);
    if (index >= 0) projects.splice(index, 1);
    projects.push(owned);
  }
  if (!fs.existsSync(path.join(selectedMain, '.docker.env'))) return {aliases: []};
  return validate(fs.readFileSync(path.join(selectedMain, '.docker.env'), 'utf8'), projects.map(file => file.content));
}
function render(selected) {
  if (!selected.aliases.length) return '';
  const challenge = `    location ^~ /.well-known/acme-challenge/ {\n        root /ssl/acme-http01;\n        try_files $uri =404;\n    }\n`;
  const redirect = `    location / {\n        return 308 ${selected.origin}$request_uri;\n    }\n`;
  const common = `    server_tokens off;\n    server_name ${selected.aliases.join(' ')};\n\n`;
  return '# Generated from saved Wizard alias configuration.\nserver {\n    listen 80;\n' + common + challenge + redirect + '}\n\n' +
    'server {\n    listen 443 ssl;\n' + common +
    `    ssl_certificate ${selected.certificate};\n    ssl_certificate_key ${selected.key};\n\n` + challenge + redirect + '}\n';
}

function configure(content, aliases, certificate, key) {
  signature(content);
  const changes = {WIZARD_ALIASES: aliases.map(hostname).join(' ')};
  if (certificate !== undefined) certificatePath(certificate);
  if (key !== undefined) certificatePath(key);
  if (certificate !== undefined) changes.WIZARD_ALIAS_SSL = certificate;
  if (key !== undefined) changes.WIZARD_ALIAS_SSL_KEY = key;
  const found = records(content).filter(record => Object.hasOwn(changes, record.key));
  requireValue(new Set(found.map(record => record.key)).size === found.length, 'Duplicate alias configuration assignment.');
  let next = content;
  for (const record of found.reverse()) next = next.slice(0, record.start) + next.slice(record.end);
  if (!next.endsWith('\n')) next += '\n';
  next += Object.entries(changes).map(([name, value]) => 'export ' + name + '=' + JSON.stringify(value)).join('\n') + '\n';
  signature(next);
  return next;
}
function configureFile(args) {
  const options = {}, aliases = [];
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--clear') { requireValue(!options.clear, 'Duplicate --clear.'); options.clear = true; continue; }
    requireValue(['--config', '--projects', '--alias', '--certificate', '--key', '--output'].includes(key) &&
      typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'), 'Invalid alias configuration arguments.');
    const value = args[++i];
    if (key === '--alias') aliases.push(value);
    else { requireValue(!Object.hasOwn(options, key), 'Duplicate alias configuration argument.'); options[key] = value; }
  }
  requireValue(options['--config'] && options['--output'] && (aliases.length > 0) !== !!options.clear &&
    (options['--certificate'] === undefined) === (options['--key'] === undefined),
  'Use configure --config FILE --output NEW_FILE (--alias HOST ... | --clear) [--projects DIRECTORY] [--certificate /ssl/FILE --key /ssl/FILE].');
  const source = fs.realpathSync(options['--config']);
  requireValue(fs.statSync(source).isFile() && path.resolve(options['--output']) !== source, 'Write the updated configuration to a new private file.');
  const content = fs.readFileSync(source, 'utf8');
  const next = configure(content, aliases, options['--certificate'], options['--key']);
  validate(next, projectFiles(options['--projects'] || path.join(path.dirname(source), '.projects.env')).map(file => file.content));
  const fd = fs.openSync(options['--output'], fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.fchmodSync(fd, 0o600); fs.writeFileSync(fd, next); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  console.log('Validated private configuration written; load it with Wizard Open, then review, back up and Push.');
}

module.exports = {aliasKeys, signature, literal, records, settings, hostname, conflicts, validate, projectFiles,
  validateFiles, validateImport, render, configure, configureFile};
if (require.main === module) {
  try {
    const [action, ...args] = process.argv.slice(2);
    if (action === 'render') process.stdout.write(args[2] === 'recovery' ? '' : render(validateFiles(args[0], args[1])));
    else if (action === 'validate') validateFiles(args[0], args[1]);
    else if (action === 'validate-import') validateImport(args[0], args[1]);
    else if (action === 'configure') configureFile(args);
    else throw Error('Use render, validate, validate-import or configure.');
  } catch (error) { console.error('Wizard aliases: ' + error.message); process.exitCode = 1; }
}
