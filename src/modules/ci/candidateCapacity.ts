const gib = 1024 ** 3;
export const limits = Object.freeze({
  candidateMemoryBytes: 12 * gib,
  hostReserveBytes: 2 * gib,
  minimumFreeBytes: 40 * gib,
});

export function assess(
  memory: string,
  filesystem: { bavail: number | bigint; bsize: number | bigint },
) {
  const matches = [...memory.matchAll(/^MemAvailable:\s+(\d+)\s+kB\s*$/gm)];

  if (matches.length !== 1) {
    throw Error('Cannot establish available host memory.');
  }

  const availableMemoryBytes = Number(matches[0][1]) * 1024;
  const availableFilesystemBytes = Number(filesystem.bavail) * Number(filesystem.bsize);

  if (
    ![availableMemoryBytes, availableFilesystemBytes].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
  ) {
    throw Error('Cannot establish available candidate capacity.');
  }

  const memoryReady = availableMemoryBytes >= limits.candidateMemoryBytes + limits.hostReserveBytes;
  const diskReady = availableFilesystemBytes >= limits.minimumFreeBytes;
  return {
    ...limits,
    availableMemoryBytes,
    availableFilesystemBytes,
    memoryReady,
    diskReady,
    capacityReady: memoryReady && diskReady,
  };
}
