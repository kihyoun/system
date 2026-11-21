import { operationSignals } from './operation-cancellation';
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { lifecyclePolicy } from '../release/lifecycle-policy';
import { HostModule } from './host.module';
import { PairedControllerService, type PairedControllerInput } from './paired-controller.service';
import { requireValue as ensure } from './install';
export async function pairedControllerMain(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      operation: { type: 'string', default: 'update' },
      checkout: { type: 'string' },
      'persistence-env': { type: 'string' },
      'checkpoint-dir': { type: 'string' },
      release: { type: 'string' },
      evidence: { type: 'string' },
      controller: { type: 'string' },
      wizard: { type: 'string' },
      'release-metadata': { type: 'string' },
      'gitlab-url': { type: 'string' },
      'token-file': { type: 'string' },
      'redirect-from': { type: 'string' },
      timeout: { type: 'string', default: '1200' },
      'check-only': { type: 'boolean', default: false },
      'repair-stopped-controller': { type: 'boolean', default: false },
    },
  });
  ensure(
    ['update', 'status', 'rollback'].includes(values.operation),
    'invalid-controller-operation',
  );
  for (const name of ['checkout', 'persistence-env', 'checkpoint-dir'] as const)
    ensure(values[name], 'missing-' + name);
  const app = await NestFactory.createApplicationContext(
    HostModule.register({ lifecycleEvidence: lifecyclePolicy() }),
    { logger: false },
  );
  const cancellation = operationSignals();
  try {
    const result = await app.get(PairedControllerService).execute({
      signal: cancellation.signal,
      operation: values.operation as PairedControllerInput['operation'],
      checkout: values.checkout!,
      persistenceEnv: values['persistence-env']!,
      checkpoint: values['checkpoint-dir']!,
      releaseFile: values.release,
      evidenceFile: values.evidence,
      controller: values.controller,
      wizard: values.wizard,
      releaseMetadata: values['release-metadata'],
      gitlabUrl: values['gitlab-url'],
      tokenFile: values['token-file'],
      redirectFrom: values['redirect-from'],
      timeout: Number(values.timeout),
      checkOnly: values['check-only'],
      repairStoppedController: values['repair-stopped-controller'],
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    cancellation.close();
    await app.close();
  }
}
if (require.main === module)
  void pairedControllerMain().catch(() => {
    process.stderr.write(
      'Controller update stopped; inspect the retained operation before recovery.\n',
    );
    process.exitCode = 1;
  });
