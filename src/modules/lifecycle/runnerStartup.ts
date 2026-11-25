import fs from 'node:fs';
import path from 'node:path';
import { readPrivateInput } from '../host/privateInput';
interface RunnerOwner {
  format: string;
  operation: string;
  pid: number;
  runner?: { checkout: string; operation: string; boot: string; namespace: string; start: string };
}
function identity(pid: number) {
  const content = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  const fields = content.slice(content.lastIndexOf(')') + 2).split(' ');

  if (!/^[0-9]+$/.test(fields[19])) {
    throw Error('runner-startup-process-proof-invalid');
  }

  return fields[19];
}
function read(state: string, operation: string): RunnerOwner {
  if (!/^startup-[a-f0-9]{32}$/.test(operation)) {
    throw Error('runner-startup-operation-invalid');
  }

  const directory = path.join(state, '.storage-operation-lock');
  const stat = fs.lstatSync(directory);

  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid!() ||
    (stat.mode & 0o777) !== 0o700 ||
    fs.existsSync(path.join(state, '.gitlab-upgrade-lock')) ||
    fs.readdirSync(directory).some((name) => name !== 'startup-owner.json')
  ) {
    throw Error('runner-startup-foreign-owner');
  }

  const value = JSON.parse(
    readPrivateInput(path.join(directory, 'startup-owner.json'), 8192, {
      owner: process.getuid!(),
      mode: 0o600,
    }).toString('utf8'),
  ) as RunnerOwner;

  if (
    value.format !== 'system-controller-startup-v1' ||
    value.operation !== operation.slice(8) ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0
  ) {
    throw Error('runner-startup-owner-mismatch');
  }

  return value;
}
function write(state: string, value: RunnerOwner) {
  const directory = path.join(state, '.storage-operation-lock'),
    target = path.join(directory, 'startup-owner.json');
  const file = path.join(directory, '.runner-owner-' + process.pid);
  try {
    fs.writeFileSync(file, JSON.stringify(value) + '\n', { mode: 0o600, flag: 'wx', flush: true });
    fs.renameSync(file, target);
    const fd = fs.openSync(
      directory,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
    );
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } finally {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}
function proof(checkout: string, operation: string) {
  if (operation !== 'provision' && !/^[a-f0-9]{48}$/.test(operation)) {
    throw Error('runner-startup-operation-invalid');
  }

  return {
    checkout: fs.realpathSync(checkout),
    operation,
    boot: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    namespace: fs.readlinkSync('/proc/self/ns/pid'),
    start: identity(process.pid),
  };
}
export function attachRunnerStartup(
  state: string,
  operation: string,
  checkout: string,
  runnerOperation: string,
): void {
  const value = read(state, operation);

  if (value.pid !== process.pid) {
    throw Error('runner-startup-owner-mismatch');
  }

  value.runner = proof(checkout, runnerOperation);
  write(state, value);
}
export function runnerStartupRecovery(
  state: string,
  operation: string,
  checkout: string,
  runnerOperation: string,
  adopt = false,
): void {
  const value = read(state, operation),
    current = proof(checkout, runnerOperation),
    prior = value.runner;

  if (
    !prior ||
    prior.checkout !== current.checkout ||
    prior.operation !== runnerOperation ||
    !/^[a-f0-9-]{36}$/.test(prior.boot) ||
    !/^pid:\[[0-9]+\]$/.test(prior.namespace) ||
    !/^[0-9]+$/.test(prior.start)
  ) {
    throw Error('runner-startup-legacy-or-foreign-owner');
  }

  if (prior.boot === current.boot) {
    if (prior.namespace !== current.namespace) {
      throw Error('runner-startup-namespace-ambiguous');
    }

    try {
      if (identity(value.pid) === prior.start) {
        throw Error('runner-startup-owner-live');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  if (adopt) {
    value.pid = process.pid;
    value.runner = current;
    write(state, value);
  }
}
