import * as state from './state';
import { DeploymentPort, DeploymentRecord, DeploymentSlot } from './types';
export class DeploymentSession {
  constructor(private readonly io: DeploymentPort) {}

  checkFragment(text: string | null, allowed: (DeploymentRecord | null | undefined)[]) {
    if (
      text !== null &&
      !allowed.some(
        (value) =>
          value &&
          text.startsWith(state.marker(value) + '\n') &&
          value.routeHash === state.hash(text),
      )
    ) {
      throw new Error('Candidate route is not owned by this reservation.');
    }
  }

  async reconcile(slot: DeploymentSlot): Promise<DeploymentSlot> {
    if (!slot.pending) {
      return slot;
    }

    const pending = slot.pending;
    const fragment = this.io.readFragment(pending.kind);
    this.checkFragment(fragment, [pending, slot.active]);

    if (
      fragment?.startsWith(state.marker(pending) + '\n') &&
      state.hash(fragment) === pending.routeHash
    ) {
      if (!(await this.io.health(pending, { once: true }))) {
        throw new Error('Pending routed candidate is unhealthy; explicit recovery is required.');
      }

      await this.io.reload();
      const next = {
        ...slot,
        active: { ...pending, state: 'active' as const },
        pending: null,
        tombstone: null,
        retired: [
          ...(slot.retired || []),
          ...(slot.active && slot.active.containerName !== pending.containerName
            ? [slot.active]
            : []),
        ],
      };
      await this.io.save({ ...this.io.environment.deployments, [pending.kind]: next });
      return next;
    }

    if (pending.containerName !== slot.active?.containerName) {
      await this.io.remove(pending);
      await this.io.removeNetwork(pending);
    }

    const next = { ...slot, pending: null };
    await this.io.save({ ...this.io.environment.deployments, [pending.kind]: next });
    return next;
  }

  async cleanupRetired(slot: DeploymentSlot): Promise<DeploymentSlot> {
    if (!slot.retired?.length) {
      return slot;
    }

    for (const value of slot.retired) {
      await this.io.remove(value);
      await this.io.removeNetwork(value);
    }
    const next = { ...slot, retired: [] };
    await this.io.save({ ...this.io.environment.deployments, [this.io.request.kind]: next });
    return next;
  }

  async cleanupTombstone(slot: DeploymentSlot): Promise<DeploymentSlot> {
    if (!slot.tombstone || slot.active || slot.pending) {
      return slot;
    }

    const stopped = slot.tombstone;
    await this.io.remove(stopped);
    await this.io.removeNetwork(stopped);

    if (await this.io.inspected(stopped.networkName, 'network')) {
      throw new Error(
        'Stopped owned network is still in use; reconcile it before reusing the host.',
      );
    }

    const next = { ...slot, tombstone: { ...stopped, cleanupComplete: true } };
    await this.io.save({ ...this.io.environment.deployments, [this.io.request.kind]: next });
    return next;
  }

  async cleanupStoppedRoute(slot: DeploymentSlot): Promise<DeploymentSlot> {
    if (slot.active || slot.pending) {
      throw new Error('Stop active and reconcile pending deployments before route cleanup.');
    }

    if (!slot.tombstone) {
      return slot;
    }

    slot = await this.cleanupTombstone(slot);

    if (!slot.tombstone) {
      throw new Error('Stopped deployment is required.');
    }

    const previous = this.io.readFragment(this.io.request.kind);
    this.checkFragment(previous, [slot.tombstone]);

    if (previous === null) {
      return slot;
    }

    this.io.writeFragment(this.io.request.kind, null);
    try {
      await this.io.reload();
      const next = { ...slot, tombstone: { ...slot.tombstone, routeRemoved: true } };
      await this.io.save({ ...this.io.environment.deployments, [this.io.request.kind]: next });
      return next;
    } catch (error) {
      this.io.writeFragment(this.io.request.kind, previous);
      await this.io.reload(true);
      throw error;
    }
  }

  async refreshActive(slot: DeploymentSlot) {
    const active = slot.active;

    if (!active) {
      throw new Error('Active deployment is required.');
    }

    const previous = this.io.readFragment(active.kind);
    this.checkFragment(previous, [active]);

    if (!(await this.io.health(active, { once: true }))) {
      throw new Error('Existing candidate is unhealthy.');
    }

    const inspected = await this.io.owned(active);
    const route = state.route(
      active,
      this.io.setting,
      inspected?.networks?.[active.networkName]?.IPAddress,
    );

    if (route === previous) {
      return { state: 'active' as const, unchanged: true };
    }

    const pending = { ...active, state: 'pending' as const, routeHash: state.hash(route) };
    await this.io.save({ ...this.io.environment.deployments, [active.kind]: { ...slot, pending } });
    try {
      this.io.writeFragment(active.kind, route);
      await this.io.reload();
      await this.io.save({
        ...this.io.environment.deployments,
        [active.kind]: { ...slot, active: { ...pending, state: 'active' as const }, pending: null },
      });
      return { state: 'active' as const, reconciled: true };
    } catch (error) {
      this.io.cleanupDeadline ||= Date.now() + 90000;
      this.io.writeFragment(active.kind, previous);
      await this.io.reload(true);
      await this.io.save(
        { ...this.io.environment.deployments, [active.kind]: { ...slot, pending: null } },
        true,
      );
      throw error;
    }
  }

  async deploy(slot: DeploymentSlot, imageRef: string) {
    const value = state.record(this.io.request, this.io.setting.host, imageRef);
    let plan = state.deployPlan(slot, value);

    if (plan.noop) {
      return this.refreshActive(slot);
    }

    const previous = this.io.readFragment(this.io.request.kind);
    this.checkFragment(previous, [slot.active, slot.pending, slot.tombstone]);
    slot = await this.cleanupTombstone(slot);
    plan = state.deployPlan(slot, value);
    await this.io.save({ ...this.io.environment.deployments, [this.io.request.kind]: plan.slot });
    let routed = false,
      committed = false;
    try {
      await this.io.network(value);
      const existing = await this.io.owned(value);

      if (!existing) {
        // CI preloads using its ordinary job-scoped registry credential. No
        // credential crosses into the helper or canonical controller.
        await this.io.command(['image', 'inspect', '--format', '{{.Id}}', imageRef]);
        const args = [
          'run',
          '-d',
          '--restart',
          'unless-stopped',
          '--log-driver',
          'json-file',
          '--log-opt',
          'max-size=10m',
          '--log-opt',
          'max-file=3',
          '--memory',
          '512m',
          '--cpus',
          '1',
          '--pids-limit',
          '128',
          '--network',
          value.networkName,
          '--name',
          value.containerName,
        ];
        for (const [key, val] of Object.entries(state.labels(value))) {
          args.push('--label', key + '=' + val);
        }
        args.push(imageRef);
        await this.io.command(args);
      }

      if (!(await this.io.health(value))) {
        throw new Error('Candidate did not become healthy.');
      }

      const inspected = await this.io.owned(value);
      const address = inspected?.networks?.[value.networkName]?.IPAddress;
      const route = state.route(value, this.io.setting, address);
      value.routeHash = state.hash(route);
      await this.io.save({
        ...this.io.environment.deployments,
        [this.io.request.kind]: { ...plan.slot, pending: value },
      });
      this.io.writeFragment(this.io.request.kind, route);
      routed = true;
      await this.io.reload();
      const next = {
        ...plan.slot,
        active: { ...value, state: 'active' as const },
        pending: null,
        tombstone: null,
        retired: [
          ...(slot.retired || []),
          ...(slot.active && slot.active.containerName !== value.containerName
            ? [slot.active]
            : []),
        ],
      };
      await this.io.save({ ...this.io.environment.deployments, [this.io.request.kind]: next });
      committed = true;
      await this.cleanupRetired(next);
      return {
        state: 'active' as const,
        host: value.host,
        sourceCommit: value.sourceCommit,
        pipelineId: value.pipelineId,
      };
    } catch (error) {
      if (committed) {
        throw new Error('Candidate is active; retired resource cleanup requires reconciliation.');
      }

      this.io.cleanupDeadline ||= Date.now() + 90000;
      try {
        if (routed) {
          this.io.writeFragment(this.io.request.kind, previous);
          await this.io.reload(true);
        }

        await this.io.remove(value, true);
        await this.io.removeNetwork(value, true);
        await this.io.save(
          {
            ...this.io.environment.deployments,
            [this.io.request.kind]: { ...plan.slot, pending: null },
          },
          true,
        );
      } catch (_) {
        throw new Error(
          'Environment recovery is incomplete; inspect its pending receipt before retrying.',
        );
      }
      throw error;
    }
  }

  async stop(slot: DeploymentSlot) {
    const plan = state.stopPlan(slot, this.io.request);

    if (plan.noop) {
      return { state: 'stopped', unchanged: true };
    }

    const previous = this.io.readFragment(this.io.request.kind);
    this.checkFragment(previous, [plan.active]);
    const tombstoneRoute = state.route(plan.slot.tombstone, this.io.setting);
    plan.slot.tombstone.routeHash = state.hash(tombstoneRoute);
    this.io.writeFragment(this.io.request.kind, tombstoneRoute);
    try {
      await this.io.reload();
    } catch (_) {
      this.io.writeFragment(this.io.request.kind, previous);
      await this.io.reload(true);
      throw new Error('Stop route change failed; previous route restored.');
    }
    // Receipt tombstone is durable before deleting resources; retries may only
    // clean that exact tombstone, never a newer active generation.
    try {
      await this.io.save({ ...this.io.environment.deployments, [this.io.request.kind]: plan.slot });
    } catch (_) {
      this.io.writeFragment(this.io.request.kind, previous);
      await this.io.reload(true);
      throw new Error('Stop receipt changed; previous route restored.');
    }
    await this.io.remove(plan.active);
    await this.io.removeNetwork(plan.active);
    return { state: 'stopped', host: plan.active.host };
  }
}
