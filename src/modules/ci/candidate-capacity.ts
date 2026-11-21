const GIB = 1024 ** 3;
export const LIMITS = Object.freeze({
  candidateMemoryBytes: 12 * GIB,
  hostReserveBytes: 2 * GIB,
  minimumFreeBytes: 40 * GIB,
});

export function assess(
  memory: string,
  filesystem: { bavail: number | bigint; bsize: number | bigint },
) {
  const matches = [...memory.matchAll(/^MemAvailable:\s+(\d+)\s+kB\s*$/gm)];
  if (matches.length !== 1) throw Error('Cannot establish available host memory.');
  const availableMemoryBytes = Number(matches[0][1]) * 1024;
  const availableFilesystemBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  if (
    ![availableMemoryBytes, availableFilesystemBytes].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  )
    throw Error('Cannot establish available candidate capacity.');
  const memoryReady = availableMemoryBytes >= LIMITS.candidateMemoryBytes + LIMITS.hostReserveBytes;
  const diskReady = availableFilesystemBytes >= LIMITS.minimumFreeBytes;
  return {
    ...LIMITS,
    availableMemoryBytes,
    availableFilesystemBytes,
    memoryReady,
    diskReady,
    capacityReady: memoryReady && diskReady,
  };
}
