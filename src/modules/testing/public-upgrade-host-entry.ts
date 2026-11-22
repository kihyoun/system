import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { PublicUpgradeHostModule } from './public-upgrade-host.module';
import {
  PublicUpgradeHostService,
  type PublicUpgradeFixtureOperation,
} from './public-upgrade-host.service';
import { parsePublicUpgradeInput } from '../host/public-upgrade-entry';
import { HostPolicyError } from '../host/install';
import { record } from '../release/source-identity';
import {
  publicUpgradePlanFailureStep,
  publicUpgradePlanStep,
} from '../host/public-upgrade-failure-context';

export function fixtureDiagnostic(error: unknown, diagnosticsValue: unknown): string {
  const diagnostics = record(diagnosticsValue),
    errors = record(diagnostics.errors);
  if (error instanceof HostPolicyError && Object.hasOwn(errors, error.code))
    return String(errors[error.code]);
  if (error && typeof error === 'object') {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return 'file-missing';
    if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
  }
  if (error instanceof SyntaxError) return 'json-invalid';
  if (error instanceof TypeError) return 'type-error';
  const step = publicUpgradePlanFailureStep(error),
    steps = record(diagnostics.planSteps);
  if (step && Object.hasOwn(steps, step)) return String(steps[step]);
  return String(diagnostics.fallback);
}
export async function publicUpgradeHostMain(
  args = process.argv.slice(2),
  directory = process.env.SYSTEM_PUBLIC_UPGRADE_FIXTURE || '',
): Promise<void> {
  const checkout = path.join(directory, 'source');
  const diagnostics = JSON.parse(
    fs.readFileSync(path.join(checkout, 'tests/e2e/public-upgrade-diagnostics.json'), 'utf8'),
  );
  let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;
  try {
    const input =
      args[0] === 'gitlab'
        ? { gitlab: args.slice(1) }
        : args.length === 1 &&
            [
              'initialize',
              'restore-original',
              'freeze-publication',
              'gitlab-previous-selectors',
              'save-migrated-public-selection',
              'restore-migrated-public-selection',
              'candidate-pair-selectors',
            ].includes(args[0])
          ? (args[0] as PublicUpgradeFixtureOperation)
          : parsePublicUpgradeInput(args);
    const execute = async () => {
      app = await NestFactory.createApplicationContext(
        PublicUpgradeHostModule.register(directory, checkout),
        { logger: false, abortOnError: false },
      );
      return app.get(PublicUpgradeHostService).execute(directory, input);
    };
    const result =
      typeof input === 'object' && 'operation' in input && input.operation === 'plan'
        ? await publicUpgradePlanStep('request', execute)
        : await execute();
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stderr.write(String(diagnostics.marker) + fixtureDiagnostic(error, diagnostics) + '\n');
    process.exitCode = 1;
  } finally {
    await app?.close();
  }
}
if (require.main === module)
  void publicUpgradeHostMain().catch(() => {
    process.stderr.write('SYSTEM_PUBLIC_UPGRADE_DIAGNOSTIC unclassified-error\n');
    process.exitCode = 1;
  });
