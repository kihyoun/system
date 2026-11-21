import 'reflect-metadata';
import fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { ResourcesModule } from './resources.module';
import { ResourceCollectorService, validateOptions } from './collector.service';
import { ResourceBenchmarkService } from './benchmark.service';
import { WindowsResourceService } from './windows.service';
export async function main(args = process.argv.slice(2)) {
  const action = args.shift();
  if (!['collect', 'collect-windows', 'benchmark'].includes(action || ''))
    throw Error('resource-action-required');
  const values: Record<string, string> = {};
  let execute = false;
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--execute' && action === 'benchmark' && !execute) {
      execute = true;
      continue;
    }
    if (
      !/^--[a-z-]+$/.test(key) ||
      key in values ||
      index + 1 >= args.length ||
      args[index + 1].startsWith('--')
    )
      throw Error('invalid-resource-arguments');
    values[key] = args[++index];
  }
  const allowed =
    action === 'benchmark'
      ? ['--case', '--templates', '--source-revision', '--output', '--lease-deadline-epoch']
      : [
          '--samples',
          '--interval',
          '--budget',
          '--max-containers',
          '--output',
          ...(action === 'collect-windows'
            ? ['--distribution', '--wsl-backing-volume', '--linux-node']
            : []),
        ];
  if (Object.keys(values).some((key) => !allowed.includes(key)))
    throw Error('unknown-resource-option');
  const options = {
    samples: Number(values['--samples'] ?? 3),
    interval: Number(values['--interval'] ?? 2),
    budget: Number(values['--budget'] ?? 12),
    maxContainers: Number(values['--max-containers'] ?? 32),
  };
  if (action !== 'benchmark') validateOptions(options);
  const app = await NestFactory.createApplicationContext(ResourcesModule, {
      logger: false,
      abortOnError: false,
    }),
    abort = new AbortController(),
    cancel = () => abort.abort();
  process.on('SIGTERM', cancel);
  process.on('SIGINT', cancel);
  try {
    let result: unknown;
    if (action === 'benchmark') {
      for (const key of ['--case', '--templates', '--source-revision', '--output'])
        if (!values[key]) throw Error('benchmark-input-required');
      result = await app.get(ResourceBenchmarkService).execute(
        {
          case: values['--case'],
          templates: values['--templates'],
          sourceRevision: values['--source-revision'],
          output: values['--output'],
          execute,
          leaseDeadline:
            values['--lease-deadline-epoch'] === undefined
              ? undefined
              : Number(values['--lease-deadline-epoch']),
        },
        process.env,
        abort.signal,
      );
    } else if (action === 'collect-windows')
      result = await app.get(WindowsResourceService).collect(
        {
          ...options,
          distribution: values['--distribution'] || 'Ubuntu',
          backingVolume: values['--wsl-backing-volume'] || 'E:',
          linuxNode: values['--linux-node'] || 'node',
        },
        abort.signal,
      );
    else result = await app.get(ResourceCollectorService).collect(options, abort.signal);
    const text = JSON.stringify(result, null, 2) + '\n',
      output = values['--output'];
    if (action !== 'benchmark' && output && output !== '-')
      fs.writeFileSync(output, text, { flag: 'wx', mode: 0o600 });
    else process.stdout.write(text);
  } finally {
    process.off('SIGTERM', cancel);
    process.off('SIGINT', cancel);
    await app.close();
  }
}
if (require.main === module)
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : '';
    console.error(/^[a-z][a-z0-9-]+$/.test(message) ? message : 'resource-operation-failed');
    process.exitCode = 1;
  });
