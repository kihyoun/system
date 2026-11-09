import {execFile} from 'child_process';
import http from 'http';

export const PULL_TIMEOUT_MS = 45000;
export function validHelperImage(image: string): boolean {
  return typeof image === 'string' && image.length <= 512 &&
    /^[a-z0-9][a-z0-9.:-]*\/[a-zA-Z0-9_./:-]+@sha256:[a-f0-9]{64}$/.test(image) &&
    !image.includes('..') && !image.includes('//');
}
export function dockerRead(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile('docker', ['--host=unix:///var/run/docker.sock', ...args],
    {timeout: 3000, maxBuffer: 262144, encoding: 'utf8'}, (error, out) => error ? reject(new Error('Runner inspection unavailable')) : resolve(out)));
}
export interface RunnerPullContext {runner: string; image: string; daemon: string; auth: string; authentication: string}
export async function inspectRunner(runner: string, read = dockerRead): Promise<RunnerPullContext> {
  if (!/^(?:[a-z0-9][a-z0-9_-]*_)?runner_docker_[1-9][0-9]?$/.test(runner)) throw new Error('Unsupported runner');
  const rows = JSON.parse(await read(['container', 'inspect', runner]));
  const row = rows[0];
  if (rows.length !== 1 || row.Name !== '/' + runner || row.State?.Running !== true ||
      !row.Mounts?.some((mount: any) => mount.Type === 'bind' && mount.Source === '/var/run/docker.sock' && mount.Destination === '/var/run/docker.sock')) throw new Error('Unsupported daemon');
  const content = await read(['exec', runner, 'cat', '/etc/gitlab-runner/config.toml']);
  // Fail closed for multiple registrations, unsupported TOML, remote daemons,
  // dynamic image substitutions and runner environments we cannot reproduce.
  if ((content.match(/^\s*\[\[runners\]\]\s*$/gm) || []).length !== 1 ||
      !/^\s*executor\s*=\s*"docker"\s*$/m.test(content)) throw new Error('Unsupported runner configuration');
  const section = content.split(/^\s*\[runners\.docker\]\s*$/m)[1]?.split(/^\s*\[/m)[0] || '';
  const host = /^\s*host\s*=\s*"([^"\r\n]*)"\s*$/m.exec(section);
  if (/^\s*host\s*=/m.test(section) && (!host || host[1] !== 'unix:///var/run/docker.sock')) throw new Error('Unsupported daemon');
  const image = /^\s*helper_image\s*=\s*"([^"\r\n]*)"\s*$/m.exec(section)?.[1];
  if (!validHelperImage(image)) throw new Error('Explicit immutable helper image required');
  if (/DOCKER_HOST\s*=|DOCKER_AUTH_CONFIG\s*=|DOCKER_TLS_VERIFY\s*=|DOCKER_CERT_PATH\s*=/.test(content) ||
      (row.Config?.Env || []).some((entry: string) => /^(?:DOCKER_HOST|DOCKER_AUTH_CONFIG|DOCKER_TLS_VERIFY|DOCKER_CERT_PATH)=/.test(entry))) throw new Error('Unsupported Docker environment');
  return {runner, image, daemon: 'Host Docker daemon via /var/run/docker.sock; verified runner socket bind', auth: '',
    authentication: 'Anonymous helper pull; runner-specific credential configuration is not verified'};
}
export function pullHelper(context: RunnerPullContext, requestDaemon: typeof http.request = http.request,
  timeoutMs = PULL_TIMEOUT_MS): Promise<{code: string; success: boolean}> {
  // The socket is established from inspected managed runner configuration. No
  // caller URL, Docker endpoint, command or credential enters this request.
  if (!validHelperImage(context.image) || context.auth !== '') throw new Error('Unsupported helper pull');
  return new Promise(resolve => {
    let finished = false, bytes = 0, pending = '', failure = '', confirmed = false;
    const consume = (line: string) => {
      if (!line.trim()) return;
      try {
        const item = JSON.parse(line);
        if (item.error || item.errorDetail) failure = 'PULL_FAILED';
        if (typeof item.status === 'string' && /^(?:Status: )?(?:Downloaded newer image|Image is up to date)/.test(item.status)) confirmed = true;
      } catch (_) { failure = 'INVALID_DAEMON_RESPONSE'; }
    };
    const done = (success: boolean, code: string) => {
      if (finished) return;
      finished = true; clearTimeout(timer); request.destroy(); resolve({success, code});
    };
    const request = requestDaemon({socketPath: '/var/run/docker.sock', method: 'POST',
      path: '/images/create?fromImage=' + encodeURIComponent(context.image), maxHeaderSize: 16384,
      headers: {'X-Registry-Auth': Buffer.from('{}').toString('base64url')}}, response => {
      if (response.statusCode !== 200) { done(false, 'DAEMON_HTTP_ERROR'); response.destroy(); return; }
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1048576) { done(false, 'OUTPUT_LIMIT'); response.destroy(); return; }
        pending += chunk.toString('utf8');
        if (pending.length > 65536) { done(false, 'OUTPUT_LIMIT'); response.destroy(); return; }
        const lines = pending.split('\n'); pending = lines.pop() || '';
        for (const line of lines) {
          consume(line);
        }
      });
      response.once('end', () => {
        if (pending.trim()) {
          consume(pending);
        }
        if (!confirmed && !failure) failure = 'PULL_UNCONFIRMED';
        done(!failure, failure || 'PULLED');
      });
      response.once('error', () => done(false, 'DAEMON_UNAVAILABLE'));
      response.once('aborted', () => done(false, 'DAEMON_UNAVAILABLE'));
    });
    const timer = setTimeout(() => done(false, 'PULL_TIMEOUT'), Math.min(PULL_TIMEOUT_MS, Math.max(1, timeoutMs)));
    request.once('error', () => done(false, 'DAEMON_UNAVAILABLE'));
    request.end();
  });
}
