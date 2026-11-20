import { record } from '../release/source-identity';
import { requireValue as ensure } from './install';
export const coldMaintenanceScripts = {
  stop: 'for service in nginx gitlab-workhorse puma; do read -r uptime rest </proc/uptime; remaining=$(($1 - ${uptime%%.*})); if [ "$remaining" -le 0 ] || [ "$remaining" -gt 110 ]; then exit 124; fi; timeout -k 2 "$remaining" gitlab-ctl stop "$service"; state=$(/opt/gitlab/embedded/bin/sv status "/opt/gitlab/service/$service"); case "$state" in down:*) ;; *) exit 1 ;; esac; done',
  start:
    'for service in nginx gitlab-workhorse puma; do read -r uptime rest </proc/uptime; remaining=$(($1 - ${uptime%%.*})); if [ "$remaining" -le 0 ] || [ "$remaining" -gt 150 ]; then exit 124; fi; timeout -k 2 "$remaining" gitlab-ctl start "$service"; done',
  allStop:
    'read -r uptime rest </proc/uptime; remaining=$(($1 - ${uptime%%.*})); if [ "$remaining" -le 0 ] || [ "$remaining" -gt 110 ]; then exit 124; fi; timeout -k 2 "$remaining" gitlab-ctl stop',
  allDown:
    'found=false; for service in /opt/gitlab/service/*; do [ -L "$service" ] || continue; found=true; state=$(/opt/gitlab/embedded/bin/sv status "$service"); case "$state" in down:*) ;; *) exit 1 ;; esac; done; [ "$found" = true ]',
} as const;
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
  command(args: string[], timeout?: number): void;
  inspect(id: string): Row;
  phase(value: string, deadline?: number): void;
  probe(): Row;
  checkpoint(): string;
  now(): number;
  sleep(seconds: number): void;
  uptime(): number;
  mainHash(): string | null;
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
  drain(input: ColdMaintenanceInput): void {
    const gitlab = record(input.gitlab),
      id = this.id(gitlab),
      deadline = this.port.now() + input.deadline;
    let consecutive = 0;
    while (this.port.now() < deadline) {
      const current = this.port.inspect(id);
      ensure('ExecIDs' in current, 'Docker-exec-drain-inspection-is-unavailable');
      ensure(current.Id === id && this.state(current).Running, 'GitLab-changed-during-drain');
      if (
        current.ExecIDs === null ||
        (Array.isArray(current.ExecIDs) && current.ExecIDs.length === 0)
      ) {
        if (++consecutive >= 2) return;
      } else consecutive = 0;
      this.port.sleep(1);
    }
    throw Error('remote-GitLab-exec-drain-timeout');
  }
  private remote(
    input: ColdMaintenanceInput,
    script: string,
    seconds: number,
    phase: string,
  ): void {
    const deadline = Math.floor(this.port.uptime()) + seconds;
    this.port.phase(phase, deadline);
    this.port.command(
      [
        'exec',
        '--env',
        'SVWAIT=90',
        this.id(record(input.gitlab)),
        '/bin/sh',
        '-ec',
        script,
        'sh',
        String(deadline),
      ],
      seconds + 15,
    );
  }
  resume(input: ColdMaintenanceInput): void {
    const gitlab = record(input.gitlab),
      controller = record(input.controller),
      web = record(input.web),
      current = this.port.inspect(this.id(gitlab));
    ensure(
      this.state(current).Running && current.Image === gitlab.Image,
      'previous-GitLab-generation-is-not-safe-to-resume',
    );
    if (input.mainHash)
      ensure(
        this.port.mainHash() === input.mainHash,
        'configuration-changed-before-maintenance-resume',
      );
    this.remote(input, coldMaintenanceScripts.start, 150, 'old-ingress-resume-started');
    const deadline = this.port.now() + 90;
    while (true) {
      try {
        this.port.command(
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
        if (this.port.now() >= deadline) throw Error('previous-GitLab-ingress-not-ready');
        this.port.sleep(2);
      }
    }
    const currentController = this.port.inspect(this.id(controller));
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
    this.port.command(['update', '--restart=' + restart, this.id(controller)]);
    if (this.state(currentController).Paused) this.port.command(['unpause', this.id(controller)]);
    if (!this.state(this.port.inspect(this.id(web))).Running)
      this.port.command(['start', this.id(web)]);
    const resumed = this.port.inspect(this.id(controller));
    ensure(
      this.state(resumed).Running &&
        !this.state(resumed).Paused &&
        this.state(this.port.inspect(this.id(web))).Running,
      'previous-control-plane-did-not-resume',
    );
    this.port.phase('old-generation-resumed-without-database-stop');
  }
  quiesce(input: ColdMaintenanceInput): void {
    this.remote(input, coldMaintenanceScripts.stop, 110, 'scheduling-ingress-stop-started');
    if (this.port.probe().runningJobs !== 0) {
      this.resume(input);
      throw new ActiveMaintenanceJobs(
        'new-running-jobs-refused-maintenance-old-generation-resumed',
      );
    }
    this.port.phase('scheduling-ingress-stopped-final-jobs-zero');
  }
  cleanStop(input: ColdMaintenanceInput): void {
    const gitlab = record(input.gitlab);
    this.remote(input, coldMaintenanceScripts.allStop, 110, 'GitLab-services-stop-started');
    this.port.command(
      [
        'exec',
        this.id(gitlab),
        'timeout',
        '-k',
        '1',
        '20',
        '/bin/sh',
        '-ec',
        coldMaintenanceScripts.allDown,
      ],
      25,
    );
    this.drain(input);
    this.port.command(['stop', '--time', '60', this.id(gitlab)], 70);
    const stoppedGitlab = this.state(this.port.inspect(this.id(gitlab)));
    ensure(
      !stoppedGitlab.Running && stoppedGitlab.ExitCode === 0 && !stoppedGitlab.OOMKilled,
      'GitLab-stop-was-not-clean',
    );
    this.port.phase('GitLab-container-cleanly-stopped');
  }
  run(input: ColdMaintenanceInput): string {
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
    this.port.command(['update', '--restart=no', this.id(controller)]);
    this.port.phase('public-web-stop-started');
    this.port.command(['stop', '--time', '30', this.id(web)]);
    ensure(!this.state(this.port.inspect(this.id(web))).Running, 'public-web-stop-failed');
    this.port.phase('old-controller-freeze-started');
    this.port.command(['pause', this.id(controller)]);
    const frozen = this.port.inspect(this.id(controller));
    ensure(
      this.state(frozen).Paused && record(record(frozen.HostConfig).RestartPolicy).Name === 'no',
      'old-controller-was-not-frozen-with-restart-disabled',
    );
    this.drain(input);
    this.quiesce(input);
    this.port.phase('owned-runners-stop-started');
    for (const inputRow of input.runners) {
      const runner = record(inputRow);
      this.port.command(['stop', '--time', '30', this.id(runner)]);
      ensure(!this.state(this.port.inspect(this.id(runner))).Running, 'owned-runner-stop-failed');
    }
    this.cleanStop(input);
    this.port.command(['kill', this.id(controller)]);
    const stopped = this.port.inspect(this.id(controller)),
      state = this.state(stopped);
    ensure(
      !state.Running &&
        state.ExitCode === 137 &&
        !state.OOMKilled &&
        (stopped.ExecIDs === null ||
          (Array.isArray(stopped.ExecIDs) && stopped.ExecIDs.length === 0)),
      'old-controller-stop-is-uncertain',
    );
    this.port.phase('old-controller-killed-before-cold-checkpoint');
    return this.port.checkpoint();
  }
}
