// Private mirror transport boundary. Never emit Git/SSH output.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";

export function startTransport(
  args: string[],
  seconds = 30,
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) {
    throw new Error('Transport deadline must be an integer from 1 to 300 seconds');
  }

  const windows = process.platform === 'win32';
  const hostsFile = environment.GITHUB_BACKUP_KNOWN_HOSTS_FILE;
  const identity = environment.GITHUB_BACKUP_IDENTITY_FILE;

  if (hostsFile && /[\r\n\0]/.test(hostsFile)) {
    throw new Error('Invalid known-hosts selector');
  }

  if (identity && (!path.isAbsolute(identity) || /[\r\n\0]/.test(identity))) {
    throw new Error('Invalid SSH identity selector');
  }

  const ssh =
    'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=2' +
    (hostsFile
      ? ' -o ' + quote('UserKnownHostsFile=' + hostsFile) + ' -o GlobalKnownHostsFile=/dev/null'
      : '') +
    (identity ? ' -o IdentitiesOnly=yes -i ' + quote(identity) : '');
  const child = spawn('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    detached: !windows,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...environment,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      GIT_SSH_VARIANT: 'ssh',
      GIT_SSH_COMMAND: ssh,
    },
  });
  let stopping = false;
  let finished = false;
  let killer: NodeJS.Timeout | undefined;
  let resolve!: (value: number) => void;
  const done = new Promise<number>((value) => {
    resolve = value;
  });
  const finish = (code: number) => {
    if (finished) {
      return;
    }

    finished = true;
    clearTimeout(deadline);

    if (killer) {
      clearTimeout(killer);
    }

    resolve(code);
  };
  function signalGroup(signal: NodeJS.Signals) {
    if (!Number.isInteger(child.pid) || (child.pid ?? 0) <= 0) {
      return;
    }

    if (windows) {
      // Only this spawn's PID/tree is eligible. No name matching or global kill.
      const killed = spawnSync(
        path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore', timeout: 5000 },
      );

      if (killed.error || killed.status !== 0) {
        throw new Error('Transport tree cancellation failed');
      }
    } else {
      try {
        process.kill(-child.pid!, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
          throw error;
        }
      }
    }
  }
  function cancel() {
    if (finished || stopping) {
      return;
    }

    stopping = true;
    signalGroup('SIGTERM');

    // Keep the process-group deadline even if the leader exits on TERM: an
    // ignored TERM in a grandchild must not survive the transport boundary.
    if (windows) {
      finish(124);
    } else {
      killer = setTimeout(() => {
        signalGroup('SIGKILL');
        finish(124);
      }, 2000);
    }
  }
  const deadline = setTimeout(cancel, seconds * 1000);
  child.once('error', () => finish(1));
  child.once('exit', (code) => {
    if (!stopping) {
      finish(code === 0 ? 0 : 1);
    }
  });
  return { done, cancel };
}
