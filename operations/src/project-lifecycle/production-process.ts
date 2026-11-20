import { spawn } from 'node:child_process';
export function productionDocker(args: string[], input = '', timeout = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '',
      size = 0,
      finished = false;
    const done = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(output.trim());
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      done(new Error('Bounded Docker operation timed out.'));
    }, timeout);
    child.stdout.on('data', (data) => {
      size += data.length;
      if (size > 2000000) {
        child.kill('SIGKILL');
        done(new Error('Docker response exceeded its bound.'));
      } else output += data;
    });
    // Docker/Rails diagnostics can contain credentials. They never reach logs.
    child.stderr.resume();
    child.on('error', () => done(new Error('Docker command unavailable.')));
    child.on('close', (code) =>
      done(code === 0 ? undefined : new Error('Owned Production operation failed.')),
    );
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}
