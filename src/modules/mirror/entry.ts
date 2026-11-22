import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { MirrorModule } from './mirror.module';
import { MirrorService } from './mirror.service';
import { MirrorCiService } from './ci.service';
import { MirrorContext } from './ports';
import { eligibility } from './policy';
export async function main(mode: string, context: MirrorContext): Promise<string> {
  if (!['publish', 'ci', 'wizard-ci'].includes(mode)) {
    throw Error('Use publish, ci or wizard-ci');
  }

  const skip = eligibility(context.env);

  if (skip) {
    return 'GitHub backup skipped: ' + skip;
  }

  const app = await NestFactory.createApplicationContext(MirrorModule, { logger: false });
  try {
    return mode === 'publish'
      ? await app.get(MirrorService).publish(context)
      : await app.get(MirrorCiService).publish(context, mode === 'ci');
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  const abort = new AbortController();
  const cancel = () => abort.abort();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, cancel);
  }
  main(process.argv[2] || 'publish', { cwd: process.cwd(), env: process.env, signal: abort.signal })
    .then((result) => console.log(result))
    .catch((error: unknown) => {
      console.error(
        'GitHub backup failed: ' + (error instanceof Error ? error.message : 'operation failed'),
      );
      process.exitCode = 1;
    })
    .finally(() => {
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        process.off(signal, cancel);
      }
    });
}
