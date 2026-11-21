import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { RenovateModule } from './renovate.module';
import { RenovateSetupService, type SetupOptions } from './setup.service';
import { RenovateApi } from './api';
import { privateJson } from './private-files';

export function savePrivate(filename: string, value: unknown) {
  const directory = path.dirname(path.resolve(filename));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(filename, { throwIfNoEntry: false })) privateJson(filename);
  const temporary = path.join(directory, '.' + path.basename(filename) + '-' + randomUUID());
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600, flush: true });
    fs.renameSync(temporary, filename);
    const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
export async function main(args: string[]) {
  let configFile = '',
    apply = false;
  const options: SetupOptions = {},
    seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw Error('Duplicate Renovate setup option.');
    seen.add(arg);
    if (arg === '--apply') apply = true;
    else if (arg === '--rotate') options.rotate = true;
    else if (arg === '--enable') options.enabled = true;
    else if (arg === '--config' && args[index + 1] && !args[index + 1].startsWith('--'))
      configFile = args[++index];
    else if (arg === '--recover-user-id' && /^[1-9][0-9]*$/.test(args[index + 1] || ''))
      options.recoverUserId = Number(args[++index]);
    else throw Error('Invalid Renovate setup option.');
  }
  if (!configFile) throw Error('Use --config FILE.');
  const config = privateJson(configFile);
  if (!apply)
    return {
      message:
        'Validated private inputs; --apply reconciles the dedicated bot and a paused schedule (--enable activates).',
    };
  if (typeof config.admin_token_file !== 'string' || typeof config.state_file !== 'string')
    throw Error('Private token and state paths required.');
  const fd = fs.openSync(config.admin_token_file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let token: string;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.mode & 0o077 || stat.size > 16384)
      throw Error('Private administrator token required.');
    token = fs.readFileSync(fd, 'utf8').trim();
  } finally {
    fs.closeSync(fd);
  }
  const state = fs.lstatSync(config.state_file, { throwIfNoEntry: false })
    ? privateJson(config.state_file)
    : {};
  const stateFile = config.state_file;
  const api = new RenovateApi(config.endpoint, token);
  const app = await NestFactory.createApplicationContext(RenovateModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    return await app.get(RenovateSetupService).reconcile(
      api,
      config,
      state,
      {
        save: async (value) => savePrivate(stateFile, value),
        bot: (secret) => new RenovateApi(config.endpoint, secret),
        now: () => new Date(),
      },
      options,
    );
  } finally {
    await app.close();
  }
}
