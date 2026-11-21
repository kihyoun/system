import {
  controlGitLabServices,
  requireGitLabServicesDown,
} from '../gitlab-upgrade/service-control';
import { record } from '../release/source-identity';
import { requireValue as ensure } from './install';
type Row = Record<string, unknown>;
export interface ColdMaintenanceInput {
  controller: unknown;
  gitlab: unknown;
  web: unknown;
  runners: unknown[];
  deadline: number;
  mainHash: string | null;
}
export interface ColdMaintenancePort {
  command(args: string[], timeout?: number): string | void | Promise<string | void>;
  inspect(id: string): Row | Promise<Row>;
  phase(value: string, deadline?: number): void | Promise<void>;
  probe(): Row | Promise<Row>;
  checkpoint(): string | Promise<string>;
  now(): number | Promise<number>;
  sleep(seconds: number): void | Promise<void>;
  uptime(): number | Promise<number>;
  mainHash(): (string | null) | Promise<string | null>;
}
export class ActiveMaintenanceJobs extends Error {}
/** Owns cold maintenance ordering; ports expose native observations and durable bytes only. */
export class ColdMaintenanceService {
  constructor(readonly port: ColdMaintenancePort) {}
  private state(row: Row) {
    return record(row.State);
  }
  private id(row: Row) {
    ensure(typeof row.Id === 'string' && row.Id, 'container-identity-required');
    return row.Id;
  }
  private owned(row: Row, service: string) {
    const labels = record(record(row.Config).Labels);
    ensure(
      labels['com.docker.compose.project'] === 'system' &&
        labels['com.docker.compose.service'] === service,
      'owned-core-container-required',
    );
  }
  async drain(input: ColdMaintenanceInput, port = this.port): Promise<void> {
    const gitlab = record(input.gitlab),
      id = this.id(gitlab),
      deadline = (await port.now()) + input.deadline;
    let consecutive = 0;
    while ((await port.now()) < deadline) {
      const current = await port.inspect(id);
      ensure('ExecIDs' in current, 'Docker-exec-drain-inspection-is-unavailable');
      ensure(current.Id === id && this.state(current).Running, 'GitLab-changed-during-drain');
      if (
        current.ExecIDs === null ||
        (Array.isArray(current.ExecIDs) && current.ExecIDs.length === 0)
      ) {
        if (++consecutive >= 2) return;
      } else consecutive = 0;
      await port.sleep(1);
    }
    throw Error('remote-GitLab-exec-drain-timeout');
  }
  private async remote(
    input: ColdMaintenanceInput,
    action: 'start' | 'stop',
    seconds: number,
    phase: string,
    services: string[],
    port = this.port,
  ): Promise<void> {
    const deadline = Math.floor(await port.uptime()) + seconds;
    await port.phase(phase, deadline);
    await controlGitLabServices(port, this.id(record(input.gitlab)), action, seconds, services, {
      deadline,
    });
  }

  async resume(input: ColdMaintenanceInput, port = this.port): Promise<void> {
    const gitlab = record(input.gitlab),
      controller = record(input.controller),
      web = record(input.web),
      current = await port.inspect(this.id(gitlab));
    ensure(
      this.state(current).Running && current.Image === gitlab.Image,
      'previous-GitLab-generation-is-not-safe-to-resume',
    );
    if (input.mainHash)
      ensure(
        (await port.mainHash()) === input.mainHash,
        'configuration-changed-before-maintenance-resume',
      );
    await this.remote(
      input,
      'start',
      150,
      'old-ingress-resume-started',
      ['nginx', 'gitlab-workhorse', 'puma'],
      port,
    );
    const deadline = (await port.now()) + 90;
    while (true) {
      try {
        await port.command(
          [
            'exec',
            this.id(gitlab),
            'curl',
            '-fsS',
            '--max-time',
            '5',
            'http://127.0.0.1/-/readiness',
          ],
          10,
        );
        break;
      } catch {
        if ((await port.now()) >= deadline) throw Error('previous-GitLab-ingress-not-ready');
        await port.sleep(2);
      }
    }
    const currentController = await port.inspect(this.id(controller));
    ensure(
      currentController.Image === controller.Image && this.state(currentController).Running,
      'previous-controller-is-not-safe-to-resume',
    );
    const policy = record(record(controller.HostConfig).RestartPolicy);
    ensure(
      typeof policy.Name === 'string' &&
        ['no', 'always', 'unless-stopped', 'on-failure'].includes(policy.Name),
      'invalid-original-restart-policy',
    );
    let restart = policy.Name;
    if (restart === 'on-failure' && policy.MaximumRetryCount) {
      ensure(
        Number.isInteger(policy.MaximumRetryCount) && Number(policy.MaximumRetryCount) > 0,
        'invalid-original-restart-policy',
      );
      restart += ':' + String(policy.MaximumRetryCount);
    }
    await port.command(['update', '--restart=' + restart, this.id(controller)]);
    if (this.state(currentController).Paused) await port.command(['unpause', this.id(controller)]);
    if (!this.state(await port.inspect(this.id(web))).Running)
      await port.command(['start', this.id(web)]);
    const resumed = await port.inspect(this.id(controller));
    ensure(
      this.state(resumed).Running &&
        !this.state(resumed).Paused &&
        this.state(await port.inspect(this.id(web))).Running,
      'previous-control-plane-did-not-resume',
    );
    await port.phase('old-generation-resumed-without-database-stop');
  }
  async quiesce(input: ColdMaintenanceInput, port = this.port): Promise<void> {
    await this.remote(
      input,
      'stop',
      110,
      'scheduling-ingress-stop-started',
      ['nginx', 'gitlab-workhorse', 'puma'],
      port,
    );
    if ((await port.probe()).runningJobs !== 0) {
      await this.resume(input, port);
      throw new ActiveMaintenanceJobs(
        'new-running-jobs-refused-maintenance-old-generation-resumed',
      );
    }
    await port.phase('scheduling-ingress-stopped-final-jobs-zero');
  }
  async cleanStop(input: ColdMaintenanceInput, port = this.port): Promise<void> {
    const gitlab = record(input.gitlab);
    await this.remote(input, 'stop', 110, 'GitLab-services-stop-started', [''], port);
    await requireGitLabServicesDown(port, this.id(gitlab));
    await this.drain(input, port);
    await port.command(['stop', '--time', '60', this.id(gitlab)], 70);
    const stoppedGitlab = this.state(await port.inspect(this.id(gitlab)));
    ensure(
      !stoppedGitlab.Running && stoppedGitlab.ExitCode === 0 && !stoppedGitlab.OOMKilled,
      'GitLab-stop-was-not-clean',
    );
    await port.phase('GitLab-container-cleanly-stopped');
  }
  async run(input: ColdMaintenanceInput, port = this.port): Promise<string> {
    ensure(
      Number.isFinite(input.deadline) && input.deadline > 0 && input.deadline <= 180,
      'invalid-cold-maintenance-drain-budget',
    );
    const controller = record(input.controller),
      gitlab = record(input.gitlab),
      web = record(input.web);
    this.owned(web, 'web');
    this.owned(controller, 'bootstrapper');
    ensure(
      this.state(controller).Running && !this.state(controller).Paused,
      'running-unpaused-controller-required',
    );
    await port.command(['update', '--restart=no', this.id(controller)]);
    await port.phase('public-web-stop-started');
    await port.command(['stop', '--time', '30', this.id(web)]);
    ensure(!this.state(await port.inspect(this.id(web))).Running, 'public-web-stop-failed');
    await port.phase('old-controller-freeze-started');
    await port.command(['pause', this.id(controller)]);
    const frozen = await port.inspect(this.id(controller));
    ensure(
      this.state(frozen).Paused && record(record(frozen.HostConfig).RestartPolicy).Name === 'no',
      'old-controller-was-not-frozen-with-restart-disabled',
    );
    await this.drain(input, port);
    await this.quiesce(input, port);
    await port.phase('owned-runners-stop-started');
    for (const inputRow of input.runners) {
      const runner = record(inputRow);
      await port.command(['stop', '--time', '30', this.id(runner)]);
      ensure(!this.state(await port.inspect(this.id(runner))).Running, 'owned-runner-stop-failed');
    }
    await this.cleanStop(input, port);
    await port.command(['kill', this.id(controller)]);
    const stopped = await port.inspect(this.id(controller)),
      state = this.state(stopped);
    ensure(
      !state.Running &&
        state.ExitCode === 137 &&
        !state.OOMKilled &&
        (stopped.ExecIDs === null ||
          (Array.isArray(stopped.ExecIDs) && stopped.ExecIDs.length === 0)),
      'old-controller-stop-is-uncertain',
    );
    await port.phase('old-controller-killed-before-cold-checkpoint');
    return await port.checkpoint();
  }
}
