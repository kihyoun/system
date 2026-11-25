interface PendingRead {
  route: string;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}
interface CollectedRead {
  route: string;
  value: unknown;
}
export const maxRoutes = 32;
export const maxOutputBytes = 1500000;
// Coalesce independent evidence GETs, never their results. Later plan/apply
// phases must observe fresh project, pipeline, artifact and repository state.
export function batchedReads(send: (routes: string[]) => Promise<unknown>) {
  const pending: PendingRead[] = [];
  let running = false;
  async function drain() {
    while (pending.length) {
      const batch = pending.splice(0, maxRoutes);
      try {
        const values = await send(batch.map((item) => item.route));

        if (
          !Array.isArray(values) ||
          values.length !== batch.length ||
          Buffer.byteLength(JSON.stringify({ values })) > maxOutputBytes
        ) {
          throw Error(
            'Preview setup GitLab request failed; verify readiness, permissions and the recorded operation.',
          );
        }

        batch.forEach((item, index) => item.resolve(values[index]));
      } catch (error) {
        for (const item of [...batch, ...pending.splice(0)]) {
          item.reject(error);
        }
      }
    }
    running = false;
  }
  return (route: string) =>
    new Promise<unknown>((resolve, reject) => {
      if (typeof route !== 'string' || route.length > 2048 || pending.length >= 160) {
        reject(Error('Invalid preview evidence route.'));
        return;
      }

      pending.push({ route, resolve, reject });

      if (!running) {
        running = true;
        queueMicrotask(drain);
      }
    });
}
// One native collector's response belongs to one plan invocation only. Keep
// duplicate GETs distinct and refuse requests not performed by that collector.
export function collectedReads(input: unknown) {
  const result = input as { reads?: unknown };

  if (
    !result ||
    !Array.isArray(result.reads) ||
    !result.reads.length ||
    result.reads.length > maxRoutes ||
    Buffer.byteLength(JSON.stringify(result)) > maxOutputBytes ||
    result.reads.some(
      (row: unknown) =>
        !row ||
        typeof row !== 'object' ||
        !('route' in row) ||
        typeof row.route !== 'string' ||
        row.route.length > 2048 ||
        !Object.hasOwn(row, 'value'),
    )
  ) {
    throw Error(
      'Preview setup GitLab request failed; verify readiness, permissions and the recorded operation.',
    );
  }

  const pending = new Map<string, unknown[]>();
  for (const { route, value } of result.reads as CollectedRead[]) {
    if (!pending.has(route)) {
      pending.set(route, []);
    }

    pending.get(route)!.push(value);
  }
  return async (route: string) => {
    const values = pending.get(route);

    if (!values?.length) {
      throw Error('Invalid preview evidence route.');
    }

    return values.shift();
  };
}
