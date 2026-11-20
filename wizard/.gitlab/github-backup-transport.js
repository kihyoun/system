// Private transport boundary for github-backup.sh. Never emit Git/SSH output.
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const quote = value => "'" + value.replace(/'/g, "'\"'\"'") + "'";

function startTransport(args, seconds = 30) {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300) {
    throw new Error('Transport deadline must be an integer from 1 to 300 seconds');
  }
  const windows = process.platform === 'win32';
  const shell = windows ? process.env.GITHUB_BACKUP_TEST_SHELL : '/bin/sh';
  if (!shell) throw new Error('Windows offline fixture shell missing');
  const hostsFile = process.env.GITHUB_BACKUP_KNOWN_HOSTS_FILE;
  if (hostsFile && /[\r\n\0]/.test(hostsFile)) throw new Error('Invalid known-hosts selector');
  const ssh = 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o ServerAliveInterval=10 -o ServerAliveCountMax=2' +
    (hostsFile ? ' -o ' + quote('UserKnownHostsFile=' + hostsFile) + ' -o GlobalKnownHostsFile=/dev/null' : '');
  const child = spawn(shell, ['-c', 'exec git -c core.hooksPath=/dev/null "$@"', 'git', ...args], {
    detached: !windows, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never',
      GIT_SSH_VARIANT: 'ssh',
      GIT_SSH_COMMAND: ssh },
  });
  let stopping = false;
  let finished = false;
  let killer;
  let resolve;
  const done = new Promise(value => { resolve = value; });
  const finish = code => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    if (killer) clearTimeout(killer);
    resolve(code);
  };
  function signalGroup(signal) {
    if (!Number.isInteger(child.pid) || child.pid <= 0) return;
    if (windows) {
      // Only this spawn's PID/tree is eligible. No name matching or global kill.
      const killed = spawnSync(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore', timeout: 5000 });
      if (killed.error || killed.status !== 0) throw new Error('Transport tree cancellation failed');
    } else {
      try { process.kill(-child.pid, signal); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
  }
  function cancel() {
    if (finished || stopping) return;
    stopping = true;
    signalGroup('SIGTERM');
    // Keep the process-group deadline even if the leader exits on TERM: an
    // ignored TERM in a grandchild must not survive the transport boundary.
    if (windows) finish(124);
    else killer = setTimeout(() => { signalGroup('SIGKILL'); finish(124); }, 2000);
  }
  const deadline = setTimeout(cancel, seconds * 1000);
  child.once('error', () => finish(1));
  child.once('exit', code => { if (!stopping) finish(code === 0 ? 0 : 1); });
  return { done, cancel };
}

if (require.main === module) {
  try {
    const transport = startTransport(process.argv.slice(2),
      Number(process.env.GITHUB_BACKUP_TIMEOUT_SECONDS || 30));
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, transport.cancel);
    transport.done.then(code => { process.exitCode = code; });
  } catch {
    // Configuration/spawn details can contain credentials: keep errors fixed.
    process.exitCode = 1;
  }
}
module.exports = { startTransport };
