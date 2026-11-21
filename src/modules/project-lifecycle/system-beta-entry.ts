import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SystemBetaModule } from './system-beta.module';
import { SystemBetaService } from './system-beta.service';
import { BetaOptions } from './system-beta-session';
async function invoke<T>(options: BetaOptions, action: (service: SystemBetaService) => Promise<T>) {
  const app = await NestFactory.createApplicationContext(SystemBetaModule.register(options), {
    logger: false,
    abortOnError: false,
  });
  try {
    return await action(app.get(SystemBetaService));
  } finally {
    await app.close();
  }
}
export function run(
  action: string,
  env: NodeJS.ProcessEnv = process.env,
  options: BetaOptions = {},
) {
  return invoke(options, (service) => service.run(action, env));
}
export function main(args: string[]) {
  return invoke({}, (service) => service.bind(args));
}

export function stopReview(
  action: string,
  env: NodeJS.ProcessEnv = process.env,
  options: BetaOptions = {},
) {
  return invoke(options, (service) => service.stopReview(action, env));
}
