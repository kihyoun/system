import {
  spawn,
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { uptime, stat, activeGroup, record } from './child-journal';
export { uptime, stat, activeGroup } from './child-journal';
export interface WorkerJob {
  binary: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
}
export interface ChildJob extends WorkerJob {
  timeout: number;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('operation-payload-invalid');
  return value as Record<string, unknown>;
}
export function parseWorkerJob(value: unknown): WorkerJob {
  const job = object(value);
  if (
    typeof job.binary !== 'string' ||
    !job.binary ||
    !Array.isArray(job.args) ||
    job.args.some((arg) => typeof arg !== 'string') ||
    (job.cwd !== undefined && typeof job.cwd !== 'string')
  )
    throw Error('operation-owner-invalid');
  if (job.env !== undefined)
    for (const entry of Object.values(object(job.env)))
      if (entry !== undefined && typeof entry !== 'string')
        throw Error('operation-payload-invalid');
  if (job.input !== undefined && typeof job.input !== 'string' && !Buffer.isBuffer(job.input)) {
    // JSON serializes an existing Buffer as {type:'Buffer',data:[...] }.
    const input = object(job.input);
    if (
      input.type !== 'Buffer' ||
      !Array.isArray(input.data) ||
      input.data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
    )
      throw Error('operation-payload-invalid');
    job.input = Buffer.from(input.data);
  }
  return job as unknown as WorkerJob;
}
export function parseJob(value: unknown): ChildJob {
  const job = parseWorkerJob(value),
    timeout = object(value).timeout;
  if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 1800000)
    throw Error('operation-owner-invalid');
  return { ...job, timeout };
}
export function input(): Promise<ChildJob> {
  return new Promise((resolve, reject) => {
    let raw = '';
    process.stdin.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
      if (raw.length > 12 * 1024 * 1024) reject(Error('operation-payload-too-large'));
    });
    process.stdin.on('end', () => {
      try {
        resolve(parseJob(JSON.parse(raw) as unknown));
      } catch {
        reject(Error('operation-payload-invalid'));
      }
    });
    process.stdin.on('error', reject);
  });
}
type WorkerExecute = (
  binary: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => SpawnSyncReturns<string>;
export async function worker(
  read: () => Promise<WorkerJob> = input,
  execute: WorkerExecute = spawnSync,
): Promise<void> {
  const job = parseWorkerJob(await read());
  const result = execute(job.binary, job.args, {
    cwd: job.cwd,
    env: job.env,
    input: job.input,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = !result.error && Number.isInteger(result.status) ? result.status! : 1;
}
export async function watchdog(directory: string): Promise<void> {
  const job = await input(),
    owner = object(
      JSON.parse(fs.readFileSync(path.join(directory, 'upgrade-owner.json'), 'utf8')) as unknown,
    );
  if (
    owner.format !== 'system-gitlab-upgrade-lock-v1' ||
    typeof owner.operation !== 'string' ||
    !/^[a-f0-9]{32}$/.test(owner.operation)
  )
    throw Error('operation-owner-invalid');
  const child = spawn(process.execPath, [path.join(__dirname, 'child-entry.js'), 'worker'], {
    detached: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (!child.pid) throw Error('operation-child-start-failed');
  const group = child.pid,
    watchdogIdentity = stat(process.pid),
    workerIdentity = stat(group);
  if (!watchdogIdentity || !workerIdentity) throw Error('operation-child-identity-unavailable');
  let expired = false;
  const witness = {
    format: 'system-gitlab-upgrade-child-v1',
    operation: owner.operation,
    watchdogPid: process.pid,
    watchdogStart: watchdogIdentity.start,
    group,
    workerStart: workerIdentity.start,
    deadline: uptime() + job.timeout / 1000 + 3,
    phase: 'running',
    exitCode: undefined as number | undefined,
  };
  const filename = path.join(directory, 'child.json');
  record(filename, witness);
  const kill = (signal: NodeJS.Signals) => {
    if (!activeGroup(group)) return;
    const leader = stat(group);
    if (leader && leader.start !== witness.workerStart)
      throw Error('operation-group-identity-changed');
    try {
      process.kill(-group, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  let hardKillTimer: NodeJS.Timeout | undefined;
  const timeout = setTimeout(() => {
    expired = true;
    kill('SIGTERM');
    hardKillTimer = setTimeout(() => kill('SIGKILL'), 2000);
  }, job.timeout);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const completion = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  });
  child.stdin.end(JSON.stringify(job));
  const code = await completion;
  clearTimeout(timeout);
  if (hardKillTimer) clearTimeout(hardKillTimer);
  if (activeGroup(group)) {
    kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (activeGroup(group)) kill('SIGKILL');
  }
  witness.phase = 'completed';
  witness.exitCode = expired ? 124 : Number.isInteger(code) ? code! : 1;
  record(filename, witness);
  process.exitCode = witness.exitCode;
}
