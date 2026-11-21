import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { HostModule } from './host.module';
import { lifecyclePolicy } from '../release/lifecycle-policy';
import { requireValue as ensure } from './install';
import { operationSignals } from './operation-cancellation';
import {
  PublicGitlabPrerequisiteService,
  type PublicGitlabInput,
} from './public-gitlab-prerequisite.service';

export function parsePublicGitlabInput(args: string[]): PublicGitlabInput {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      operation: { type: 'string', default: 'plan' },
      checkout: { type: 'string' },
      'persistence-env': { type: 'string' },
      directory: { type: 'string' },
      repository: { type: 'string', default: 'kihyoun/system' },
      target: { type: 'string' },
      'confirm-plan': { type: 'string' },
      'confirm-checkpoint': { type: 'string' },
      'paired-checkpoint': { type: 'string' },
      timeout: { type: 'string', default: '900' },
    },
  });
  ensure(
    ['prepare', 'plan', 'promote', 'status', 'abort', 'rollback'].includes(values.operation),
    'public-gitlab-operation-invalid',
  );
  for (const name of ['checkout', 'persistence-env', 'directory'] as const)
    ensure(values[name], 'missing-' + name);
  const confirmation =
    values.operation === 'rollback' ? values['confirm-checkpoint'] : values['confirm-plan'];
  ensure(
    ['prepare', 'plan', 'status'].includes(values.operation)
      ? !values['confirm-plan'] && !values['confirm-checkpoint']
      : /^[a-f0-9]{64}$/.test(confirmation || '') &&
          !(values.operation === 'rollback'
            ? values['confirm-plan']
            : values['confirm-checkpoint']),
    'public-gitlab-explicit-confirmation-required',
  );
  return {
    operation: values.operation as PublicGitlabInput['operation'],
    checkout: values.checkout!,
    persistenceEnv: values['persistence-env']!,
    directory: values.directory!,
    repository: values.repository,
    target: values.target,
    confirmation,
    pairedCheckpoint: values['paired-checkpoint'],
    timeout: Number(values.timeout),
  };
}
export async function publicGitlabMain(args = process.argv.slice(2)): Promise<void> {
  const input = parsePublicGitlabInput(args),
    cancellation = operationSignals(),
    app = await NestFactory.createApplicationContext(
      HostModule.register({ lifecycleEvidence: lifecyclePolicy() }),
      { logger: false },
    );
  try {
    const result = await app
      .get(PublicGitlabPrerequisiteService)
      .execute({ ...input, signal: cancellation.signal });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    cancellation.close();
    await app.close();
  }
}
if (require.main === module)
  void publicGitlabMain().catch(() => {
    process.stderr.write(
      'Public GitLab prerequisite refused; inspect the retained preparation, helper, leases and checkpoint.\n',
    );
    process.exitCode = 1;
  });
