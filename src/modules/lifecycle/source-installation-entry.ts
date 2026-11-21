import {
  recordInstallation,
  type InstallationExpected,
} from '../project-lifecycle/source-installation';

export function parseSourceInstallation(args: readonly string[]): InstallationExpected {
  const names: Record<string, keyof InstallationExpected> = {
    '--controller': 'controller',
    '--wizard': 'wizard',
    '--source-revision': 'sourceCommit',
    '--source-tree': 'sourceTree',
    '--wizard-revision': 'wizardSourceRevision',
  };
  const input: Partial<InstallationExpected> = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = names[args[index]];
    if (!key || Object.hasOwn(input, key) || !args[index + 1])
      throw Error('source-installation-input-invalid');
    input[key] = args[index + 1];
  }

  if (Object.keys(input).length !== Object.keys(names).length)
    throw Error('source-installation-input-invalid');
  return input as InstallationExpected;
}

export function recordSourceInstallationMain(args = process.argv.slice(2)): void {
  try {
    recordInstallation(parseSourceInstallation(args));
    process.stdout.write(
      'Source installation provenance recorded; Production images and configuration are unchanged.\n',
    );
  } catch {
    throw Error(
      'Source installation recording refused. Supply the independently selected source identities and actual immutable image pair; retain matching saved selectors and paired image provenance.',
    );
  }
}

if (require.main === module) {
  try {
    recordSourceInstallationMain();
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : 'Source installation recording refused.') + '\n',
    );
    process.exitCode = 1;
  }
}
