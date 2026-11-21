import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validConfigurationSignature } from '../../common/configuration-validation';

export const fields = Object.freeze({
  WIZARD_OPERATOR_NAME: 'operatorName',
  WIZARD_OPERATOR_ADDRESS: 'operatorAddress',
  WIZARD_OPERATOR_EMAIL: 'contactEmail',
  WIZARD_PRIVACY_NOTICE_URL: 'privacyNoticeUrl',
  WIZARD_ACCESS_LOG_RETENTION: 'accessLogRetention',
  WIZARD_PRIVACY_TEXT: 'additionalPrivacyText',
} as const);

export const defaults = Object.freeze({
  operatorName: 'Max Mustermann',
  operatorAddress: 'Musterstraße 1\n12345 Musterstadt\nDeutschland',
  contactEmail: 'kontakt@example.com',
  privacyNoticeUrl: '',
  accessLogRetention: '',
  additionalPrivacyText: '',
});

export type PublicWizardSettings = Record<(typeof fields)[keyof typeof fields], string>;

/** Interpret a saved literal without evaluating shell substitutions. */
export function literal(value: string): string {
  let result = '',
    quote = '';
  const source = value.trim();
  if (source.includes('\0') || source.startsWith('~'))
    throw Error('Public Wizard settings must be literal strings.');
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
      if (source.slice(i).trim() && !source.slice(i).trim().startsWith('#'))
        throw Error('Unexpected public Wizard setting command.');
      break;
    } else if (!quote && /[;&|<>()]/.test(char))
      throw Error('Shell commands are not allowed in public Wizard settings.');
    else result += char;
  }

  if (quote) throw Error('Unclosed public Wizard setting quote.');
  return result;
}

export function assignments(content: string): [string, string][] {
  const values: [string, string][] = [];
  let record = '',
    quote = '',
    escaped = false;
  for (const line of content.split('\n')) {
    if (!record && (!line.trim() || line.trim().startsWith('#'))) continue;
    record += (record ? '\n' : '') + line;
    // Track private multiline assignments too: their text is never a public setting.
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote === "'") {
        if (char === "'") quote = '';
      } else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      else if (!quote && (char === "'" || char === '"')) quote = char;
      else if (!quote && char === '#' && (i === 0 || /\s/.test(line[i - 1]))) break;
    }
    if (quote || escaped) {
      escaped = false;
      continue;
    }
    const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(record);
    if (!assignment) throw Error('Unsupported saved configuration assignment.');
    values.push([assignment[1], assignment[2]]);
    record = '';
  }

  if (record) throw Error('Incomplete saved configuration assignment.');
  return values;
}

export function publicSettings(content: string | null): PublicWizardSettings {
  const values: PublicWizardSettings = { ...defaults };
  if (content === null) return values;
  if (!validConfigurationSignature(content)) {
    throw Error('Invalid saved configuration signature for public Wizard settings.');
  }
  for (const [name, value] of assignments(content))
    if (Object.hasOwn(fields, name)) values[fields[name as keyof typeof fields]] = literal(value);
  return values;
}

export function requireMountedDirectory(
  directory: string,
  mountInfo = fs.readFileSync('/proc/self/mountinfo', 'utf8'),
): string {
  const resolved = path.resolve(directory);
  if (
    fs.realpathSync(resolved) !== resolved ||
    !fs.lstatSync(resolved).isDirectory() ||
    !mountInfo.split('\n').some((line) => line.split(' ')[4] === resolved)
  )
    throw Error('Public Wizard settings require dedicated persistent mounts.');
  return resolved;
}

export function publicationMounts(
  stateDirectory: string,
  publicDirectory: string,
  mountInfo?: string,
): { state: string; directory: string } {
  const state = requireMountedDirectory(stateDirectory, mountInfo);
  const directory = requireMountedDirectory(publicDirectory, mountInfo);
  if (fs.statSync(state).dev !== fs.statSync(directory).dev)
    throw Error('Public Wizard settings must share the verified configuration filesystem.');
  return { state, directory };
}

/** Publish an allowlisted public view; saved configuration and secrets stay private. */
@Injectable()
export class WizardPublicSettingsService {
  verifyPublication(stateDirectory: string, publicDirectory: string): void {
    const { state, directory } = publicationMounts(stateDirectory, publicDirectory);
    const file = path.join(state, '.docker.env'),
      target = path.join(directory, 'privacy-instance.json');
    if (
      !fs.lstatSync(file).isFile() ||
      fs.lstatSync(file).isSymbolicLink() ||
      !fs.lstatSync(target).isFile() ||
      fs.lstatSync(target).isSymbolicLink()
    )
      throw Error('Unsafe public Wizard publication.');
    if (
      JSON.stringify(JSON.parse(fs.readFileSync(target, 'utf8'))) !==
      JSON.stringify(publicSettings(fs.readFileSync(file, 'utf8')))
    )
      throw Error(
        'Regenerate public Wizard settings from the saved configuration before promotion.',
      );
  }

  publish(configFile: string, publicDirectory: string): PublicWizardSettings {
    const directory = path.resolve(publicDirectory);
    if (fs.realpathSync(directory) !== directory || !fs.lstatSync(directory).isDirectory())
      throw Error('Unsafe public Wizard directory.');
    const config = fs.lstatSync(configFile, { throwIfNoEntry: false });
    if (config && (!config.isFile() || config.isSymbolicLink()))
      throw Error('Unsafe saved Wizard configuration.');
    const values = publicSettings(config ? fs.readFileSync(configFile, 'utf8') : null);
    const target = path.join(directory, 'privacy-instance.json');
    const previous = fs.lstatSync(target, { throwIfNoEntry: false });
    if (previous && (!previous.isFile() || previous.isSymbolicLink()))
      throw Error('Unsafe public Wizard settings destination.');
    const temporary = path.join(
      directory,
      '.privacy-instance-' + crypto.randomBytes(16).toString('hex') + '.tmp',
    );
    let fd: number | undefined;
    try {
      fd = fs.openSync(
        temporary,
        fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_WRONLY |
          fs.constants.O_NOFOLLOW,
        0o644,
      );
      fs.fchmodSync(fd, 0o644);
      fs.writeFileSync(fd, JSON.stringify(values) + '\n');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, target);
      const directoryFd = fs.openSync(directory, fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(directoryFd);
      } finally {
        fs.closeSync(directoryFd);
      }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return values;
  }

  publishMounted(stateDirectory: string, publicDirectory: string): PublicWizardSettings {
    const { state, directory } = publicationMounts(stateDirectory, publicDirectory);
    return this.publish(path.join(state, '.docker.env'), directory);
  }
}
