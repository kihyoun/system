import { HostInspectionService } from './inspection.service';
import { InspectionInputError } from './inspection-policy';
export async function inspectHost(
  service: HostInspectionService,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const values: Record<string, string> = {},
      containers: string[] = [];
    const allowed =
      command === 'container-preflight'
        ? ['--mongodb-version', '--image', '--timeout', '--planned-kernel']
        : ['--max-size', '--max-files'];
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (allowed.includes(key)) {
        if (
          Object.hasOwn(values, key) ||
          args[index + 1] === undefined ||
          args[index + 1].startsWith('--')
        )
          throw new InspectionInputError('Expected one value for ' + key + '.');
        values[key] = args[++index];
      } else if (command === 'log-policy' && !key.startsWith('-')) containers.push(key);
      else throw new InspectionInputError('Unsupported inspection argument.');
    }
    const report =
      command === 'container-preflight'
        ? await service.preflight(
            {
              mongodbVersion: values['--mongodb-version'] || '',
              image: values['--image'],
              plannedKernel: values['--planned-kernel'],
              timeout: values['--timeout'] === undefined ? undefined : Number(values['--timeout']),
            },
            env,
            signal,
          )
        : await service.logging(
            containers,
            values['--max-size'] ?? env.SYSTEM_LOG_MAX_SIZE,
            values['--max-files'] ?? env.SYSTEM_LOG_MAX_FILES,
            env,
            signal,
          );
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.log(
      JSON.stringify({
        ok: false,
        error:
          error instanceof InspectionInputError
            ? error.message
            : 'Unable to inspect host policy or selected Docker image.',
      }),
    );
    process.exitCode = 2;
  }
}
