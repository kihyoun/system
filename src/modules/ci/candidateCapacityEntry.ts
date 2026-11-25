import fs from 'node:fs';
import { assess } from './candidateCapacity';
export function candidateCapacityMain(directory = process.cwd()): void {
  try {
    const result = assess(fs.readFileSync('/proc/meminfo', 'utf8'), fs.statfsSync(directory));
    console.log(JSON.stringify(result));

    if (!result.capacityReady) {
      console.error(
        'Candidate refused: require 12 GiB available plus 2 GiB host reserve and 40 GiB free on the job filesystem.',
      );
      process.exitCode = 1;
    }
  } catch {
    console.error('Candidate refused: host capacity could not be established.');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  candidateCapacityMain();
}
