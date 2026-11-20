function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw Error(message);
}
export interface GitLabControlPort {
  command(args: string[], timeout: number): string | void | Promise<string | void>;
  uptime(): number | Promise<number>;
}
/** Native runit control shared by controller maintenance and GitLab migration. */
export async function controlGitLabServices(
  port: GitLabControlPort,
  container: string,
  action: 'start' | 'stop',
  seconds: number,
  services: string[],
  options: { deadline?: number; svWait?: number; perService?: number; grace?: number } = {},
): Promise<void> {
  const deadline = options.deadline ?? Math.floor(await port.uptime()) + seconds;
  for (const service of services) {
    const remaining = deadline - Math.floor(await port.uptime());
    ensure(remaining > 0 && remaining <= seconds, 'remote-GitLab-service-deadline-expired');
    const budget = Math.min(remaining, options.perService ?? remaining);
    await port.command(
      [
        'exec',
        '--env',
        'SVWAIT=' + String(options.svWait ?? 90),
        container,
        'timeout',
        '-k',
        '2',
        String(budget),
        'gitlab-ctl',
        action,
        ...(service ? [service] : []),
      ],
      budget + (options.grace ?? 15),
    );
    if (action === 'stop' && service) {
      const status = await port.command(
        [
          'exec',
          container,
          'timeout',
          '-k',
          '1',
          '5',
          '/opt/gitlab/embedded/bin/sv',
          'status',
          '/opt/gitlab/service/' + service,
        ],
        10,
      );
      ensure(
        typeof status === 'string' && /^down:/.test(status),
        'GitLab-service-stop-was-not-clean',
      );
    }
  }
}
export async function requireGitLabServicesDown(
  port: GitLabControlPort,
  container: string,
  seconds = 20,
): Promise<void> {
  const statuses = await port.command(
    [
      'exec',
      container,
      'timeout',
      '-k',
      '1',
      String(seconds),
      'find',
      '/opt/gitlab/service',
      '-mindepth',
      '1',
      '-maxdepth',
      '1',
      '-type',
      'l',
      '-exec',
      '/opt/gitlab/embedded/bin/sv',
      'status',
      '{}',
      '+',
    ],
    seconds + 5,
  );
  ensure(
    typeof statuses === 'string' &&
      statuses.trim().length > 0 &&
      statuses
        .trim()
        .split('\n')
        .every((line) => /^down:/.test(line)),
    'GitLab-services-not-all-down',
  );
}
export async function gitLabReadiness(
  port: Pick<GitLabControlPort, 'command'>,
  container: string,
): Promise<boolean> {
  try {
    const output = await port.command(
      [
        'exec',
        container,
        'curl',
        '-fsS',
        '--max-time',
        '5',
        '--output',
        '/dev/null',
        'http://127.0.0.1/-/readiness?all=1',
      ],
      10,
    );
    ensure(output === '', 'upgrade-readiness-response-invalid');
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'exitCode' in error &&
      [7, 22, 28, 52, 56].includes(Number(error.exitCode))
    )
      return false;
    throw error;
  }
}
