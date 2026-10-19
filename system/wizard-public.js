'use strict';
// Publish only intentionally public operator details, never the configuration.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const fields = Object.freeze({
  WIZARD_OPERATOR_NAME: 'operatorName',
  WIZARD_OPERATOR_ADDRESS: 'operatorAddress',
  WIZARD_OPERATOR_EMAIL: 'contactEmail',
  WIZARD_PRIVACY_NOTICE_URL: 'privacyNoticeUrl',
  WIZARD_ACCESS_LOG_RETENTION: 'accessLogRetention',
  WIZARD_PRIVACY_TEXT: 'additionalPrivacyText'
});
const defaults = Object.freeze({
  operatorName: 'Max Mustermann',
  operatorAddress: 'Musterstraße 1\n12345 Musterstadt\nDeutschland',
  contactEmail: 'kontakt@example.com',
  privacyNoticeUrl: '',
  accessLogRetention: '',
  additionalPrivacyText: ''
});

function literal(value) {
  let result = '', quote = '';
  const source = value.trim();
  if (source.includes('\0') || source.startsWith('~')) throw Error('Public Wizard settings must be literal strings.');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote === "'") {
      if (char === "'") quote = '';
      else result += char;
    } else if (char === '\\') {
      const next = source[++i];
      if (next === undefined) throw Error('Incomplete public Wizard setting escape.');
      if (quote === '"' && !['$', '`', '"', '\\', '\n'].includes(next)) result += '\\';
      if (next !== '\n') result += next;
    } else if (char === quote) quote = '';
    else if (!quote && (char === "'" || char === '"')) quote = char;
    else if ((char === '$' && /[A-Za-z0-9_({?*!@#$'"-]/.test(source[i + 1] || '')) || char === '`')
      throw Error('Shell expansion is not allowed in public Wizard settings.');
    else if (!quote && /\s/.test(char)) {
      if (source.slice(i).trim() && !source.slice(i).trim().startsWith('#')) throw Error('Unexpected public Wizard setting command.');
      break;
    } else if (!quote && /[;&|<>()]/.test(char)) throw Error('Shell commands are not allowed in public Wizard settings.');
    else result += char;
  }
  if (quote) throw Error('Unclosed public Wizard setting quote.');
  return result;
}

function publicSettings(content) {
  const values = {...defaults};
  if (content === null) return values;
  if (content[807] !== '$' || crypto.createHash('md5').update(content.slice(0, 1184)).digest('hex') !== 'bd4a8426355824593a5e21ad759830c1')
    throw Error('Invalid saved configuration signature for public Wizard settings.');
  let record = '', quote = '', escaped = false;
  for (const line of content.split('\n')) {
    if (!record && (!line.trim() || line.trim().startsWith('#'))) continue;
    record += (record ? '\n' : '') + line;
    // Track every assignment, including private multiline values, so a line
    // inside an unrelated secret can never be mistaken for a public setting.
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (escaped) { escaped = false; continue; }
      if (quote === "'") { if (char === "'") quote = ''; }
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      else if (!quote && (char === "'" || char === '"')) quote = char;
      else if (!quote && char === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    }
    if (quote || escaped) { escaped = false; continue; }
    const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(record);
    if (!assignment) throw Error('Unsupported saved configuration assignment.');
    if (Object.hasOwn(fields, assignment[1])) values[fields[assignment[1]]] = literal(assignment[2]);
    record = '';
  }
  if (record) throw Error('Incomplete saved configuration assignment.');
  return values;
}

function requireMountedDirectory(directory, mountInfo = fs.readFileSync('/proc/self/mountinfo', 'utf8')) {
  const resolved = path.resolve(directory);
  if (fs.realpathSync(resolved) !== resolved || !fs.lstatSync(resolved).isDirectory() ||
      !mountInfo.split('\n').some(line => line.split(' ')[4] === resolved))
    throw Error('Public Wizard settings require dedicated persistent mounts.');
  return resolved;
}

function publicationMounts(stateDirectory, publicDirectory, mountInfo) {
  const state = requireMountedDirectory(stateDirectory, mountInfo);
  const directory = requireMountedDirectory(publicDirectory, mountInfo);
  if (fs.statSync(state).dev !== fs.statSync(directory).dev)
    throw Error('Public Wizard settings must share the verified configuration filesystem.');
  return {state, directory};
}

function verifyPublication(stateDirectory, publicDirectory) {
  const {state, directory} = publicationMounts(stateDirectory, publicDirectory);
  const file = path.join(state, '.docker.env'), target = path.join(directory, 'privacy-instance.json');
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() ||
      !fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink())
    throw Error('Unsafe public Wizard publication.');
  if (JSON.stringify(JSON.parse(fs.readFileSync(target, 'utf8'))) !== JSON.stringify(publicSettings(fs.readFileSync(file, 'utf8'))))
    throw Error('Regenerate public Wizard settings from the saved configuration before promotion.');
}

function publish(configFile, publicDirectory) {
  const directory = path.resolve(publicDirectory);
  if (fs.realpathSync(directory) !== directory || !fs.lstatSync(directory).isDirectory())
    throw Error('Unsafe public Wizard directory.');
  const config = fs.lstatSync(configFile, {throwIfNoEntry: false});
  if (config && (!config.isFile() || config.isSymbolicLink())) throw Error('Unsafe saved Wizard configuration.');
  const values = publicSettings(config ? fs.readFileSync(configFile, 'utf8') : null);
  const target = path.join(directory, 'privacy-instance.json');
  const previous = fs.lstatSync(target, {throwIfNoEntry: false});
  if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw Error('Unsafe public Wizard settings destination.');
  const temporary = path.join(directory, '.privacy-instance-' + crypto.randomBytes(16).toString('hex') + '.tmp');
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o644);
    fs.fchmodSync(fd, 0o644);
    fs.writeFileSync(fd, JSON.stringify(values) + '\n');
    fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, target);
    const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY);
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return values;
}

if (require.main === module) {
  const {state, directory} = publicationMounts(process.env.SYSTEM_CONFIG_DIR || '/state', '/wizard-public');
  publish(path.join(state, '.docker.env'), directory);
}
module.exports = {fields, defaults, publicSettings, requireMountedDirectory, publicationMounts, verifyPublication, publish};
