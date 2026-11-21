import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { RenovateModule } from './renovate.module';
import { RenovateVerificationService, row, projectIds, positive } from './verification.service';
import { RenovateApi } from './api';
import { privateJson } from './private-files';

export async function main(args: string[]) {
  const values: Record<string, string> = {};
  let verify = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--verify' && !verify) {
      verify = true;
      continue;
    }
    if (
      !['--config', '--baseline'].includes(key) ||
      values[key] ||
      !args[index + 1] ||
      args[index + 1].startsWith('--')
    )
      throw Error('Use --config FILE --baseline FILE [--verify].');
    values[key] = args[++index];
  }
  if (!values['--config'] || !values['--baseline'])
    throw Error('Configuration and baseline paths required.');
  const config = privateJson(values['--config']);
  if (typeof config.state_file !== 'string') throw Error('Private state file required.');
  const state = privateJson(config.state_file);
  if (typeof state.token !== 'string') throw Error('Private bot token required.');
  const ids = projectIds(config.project_ids),
    user = positive(state.user_id);
  const api = new RenovateApi(config.endpoint, state.token);
  const app = await NestFactory.createApplicationContext(RenovateModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const service = app.get(RenovateVerificationService);
    if (verify) return await service.verify(api, config, state, privateJson(values['--baseline']));
    const baseline = {
      project_ids: ids,
      user_id: user,
      inventory: await service.inventory(api, ids),
    };
    const target = path.resolve(values['--baseline']);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, JSON.stringify(baseline), { flag: 'wx', mode: 0o600, flush: true });
    return { saved: true, message: 'Run the owned schedule before --verify.' };
  } finally {
    await app.close();
  }
}
if (require.main === module)
  void main(process.argv.slice(2)).then(
    (result) => console.log(JSON.stringify(result)),
    () => {
      console.error(
        'Renovate discovery verification failed; check private inputs and the owned schedule.',
      );
      process.exitCode = 1;
    },
  );
