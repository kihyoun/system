'use strict';

const fs = require('fs');
const GIB = 1024 ** 3;
const LIMITS = Object.freeze({candidateMemoryBytes: 12 * GIB,
  hostReserveBytes: 2 * GIB, minimumFreeBytes: 40 * GIB});

function assess(memory, filesystem) {
  const matches = [...memory.matchAll(/^MemAvailable:\s+(\d+)\s+kB\s*$/gm)];
  if (matches.length !== 1) throw Error('Cannot establish available host memory.');
  const availableMemoryBytes = Number(matches[0][1]) * 1024;
  const availableFilesystemBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  if (![availableMemoryBytes, availableFilesystemBytes].every(n => Number.isSafeInteger(n) && n >= 0))
    throw Error('Cannot establish available candidate capacity.');
  const memoryReady = availableMemoryBytes >= LIMITS.candidateMemoryBytes + LIMITS.hostReserveBytes;
  const diskReady = availableFilesystemBytes >= LIMITS.minimumFreeBytes;
  return {...LIMITS, availableMemoryBytes, availableFilesystemBytes,
    memoryReady, diskReady, capacityReady: memoryReady && diskReady};
}

module.exports = {assess, LIMITS};
if (require.main === module) {
  try {
    const result = assess(fs.readFileSync('/proc/meminfo', 'utf8'), fs.statfsSync(process.cwd()));
    console.log(JSON.stringify(result));
    if (!result.capacityReady) {
      console.error('Candidate refused: require 12 GiB available plus 2 GiB host reserve and 40 GiB free on the job filesystem.');
      process.exitCode = 1;
    }
    // Docker data may use a different filesystem. Its free space and other
    // workloads still require the operator lease described in tests/e2e/README.md.
  } catch (_) {
    console.error('Candidate refused: host capacity could not be established.');
    process.exitCode = 1;
  }
}
