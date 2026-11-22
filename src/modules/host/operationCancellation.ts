import { HostPolicyError } from './install';
export function assertOperationActive(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new HostPolicyError('host-operation-interrupted');
  }
}
/** Await owned work before observing cancellation: a guardian retains its existing
 * command budget and flock, while no subsequent operation step may mutate state. */
export function cancellationPort<T extends object>(port: T, signal?: AbortSignal): T {
  if (!signal) {
    return port;
  }

  return new Proxy(port, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);

      if (typeof value !== 'function') {
        return value;
      }

      return async (...args: unknown[]) => {
        assertOperationActive(signal);
        const result: unknown = await Reflect.apply(value, target, args);
        assertOperationActive(signal);
        return result;
      };
    },
  });
}
export function operationSignals() {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  return {
    signal: controller.signal,
    close() {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    },
  };
}
