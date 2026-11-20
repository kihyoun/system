import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import http from 'node:http';
export const GITLAB_LOCK_EXEC_HTTP = Symbol('GITLAB_LOCK_EXEC_HTTP');
export interface GitlabLockExecHttp {
  request(
    method: 'GET' | 'POST',
    route: string,
    body?: unknown,
  ): Promise<{ status: number; value: unknown }>;
}
function identity(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw Error('gitlab-lock-exec-identity-required');
  return value;
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('gitlab-lock-exec-response-invalid');
  return value as Record<string, unknown>;
}
/** Only the daemon's local Unix socket; no proxy, environment endpoint or redirect. */
@Injectable()
export class GitlabLockExecHttpTransport implements GitlabLockExecHttp {
  request(
    method: 'GET' | 'POST',
    route: string,
    body?: unknown,
  ): Promise<{ status: number; value: unknown }> {
    if (!/^(?:\/containers\/[a-f0-9]{64}\/exec|\/exec\/[a-f0-9]{64}\/(?:start|json))$/.test(route))
      throw Error('gitlab-lock-exec-route-invalid');
    return new Promise((resolve, reject) => {
      const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
      let finished = false;
      let timer: NodeJS.Timeout | undefined;
      const fail = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(
          Object.assign(Error('gitlab-lock-exec-request-incomplete'), {
            uncertain: method === 'POST',
          }),
        );
      };
      const request = http.request(
        {
          socketPath: '/var/run/docker.sock',
          path: '/v1.44' + route,
          method,
          headers: bytes
            ? { 'Content-Type': 'application/json', 'Content-Length': bytes.length }
            : {},
        },
        (response) => {
          const chunks: Buffer[] = [];
          let length = 0;
          response.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > 1024 * 1024) {
              fail();
              response.destroy();
              request.destroy();
            } else chunks.push(chunk);
          });
          response.on('error', fail);
          response.on('aborted', fail);
          response.on('end', () => {
            if (finished) return;
            try {
              const text = Buffer.concat(chunks).toString('utf8');
              const value = text ? JSON.parse(text) : null;
              finished = true;
              clearTimeout(timer);
              resolve({ status: response.statusCode ?? 0, value });
            } catch {
              fail();
            }
          });
        },
      );
      timer = setTimeout(() => {
        fail();
        request.destroy();
      }, 60000);
      request.on('error', fail);
      request.on('close', () => clearTimeout(timer));
      request.end(bytes);
    });
  }
}
export interface GitlabLockExecProof {
  id: string;
  containerId: string;
  running: boolean;
  exitCode: number | null;
}
/** Durable detached native psql execution; create never starts the process. */
@Injectable()
export class GitlabLockExecService {
  constructor(@Inject(GITLAB_LOCK_EXEC_HTTP) private readonly transport: GitlabLockExecHttp) {}
  async create(
    containerId: string,
    user: string,
    command: string[],
  ): Promise<{ id: string; digest: string }> {
    identity(containerId);
    if (
      !/^[1-9][0-9]*:[1-9][0-9]*$/.test(user) ||
      command[0] !== 'env' ||
      command[1] !== '-i' ||
      !command.includes('/opt/gitlab/embedded/bin/psql')
    )
      throw Error('gitlab-lock-native-command-invalid');
    return this.createExecution(containerId, user, command);
  }
  /** Fixed runner credential requests only; never exposes a general command executor. */
  async createRunnerRequest(
    containerId: string,
    user: string,
    nonce: string,
    route: string,
  ): Promise<{ id: string; digest: string }> {
    identity(containerId);
    if (
      !/^(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)$/.test(user) ||
      !/^[a-f0-9]{48}$/.test(nonce) ||
      !/^(?:user\/runners|runners\/[1-9][0-9]*\/reset_authentication_token)$/.test(route)
    )
      throw Error('gitlab-runner-request-invalid');
    const directory = '/etc/gitlab/system-bootstrapper-auth/runner-request-' + nonce;
    return this.createExecution(containerId, user, [
      'env',
      '-i',
      'PATH=/opt/gitlab/embedded/bin:/usr/bin:/bin',
      'curl',
      '-q',
      '--proxy',
      '',
      '--silent',
      '--max-time',
      '60',
      '--max-filesize',
      '65536',
      '--proto',
      '=http',
      '--request',
      'POST',
      '--config',
      directory + '/request',
      '--output',
      directory + '/response',
      '--dump-header',
      directory + '/headers',
      'http://127.0.0.1/api/v4/' + route,
    ]);
  }
  private async createExecution(
    containerId: string,
    user: string,
    command: string[],
  ): Promise<{ id: string; digest: string }> {
    const response = await this.transport.request('POST', `/containers/${containerId}/exec`, {
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false,
      Tty: false,
      Privileged: false,
      User: user,
      Cmd: command,
    });
    if (response.status !== 201) throw Error('gitlab-lock-exec-create-refused');
    return {
      id: identity(String(row(response.value).Id)),
      digest: createHash('sha256').update(JSON.stringify({ user, command })).digest('hex'),
    };
  }
  async inspect(
    execId: string,
    containerId: string,
    digest: string,
  ): Promise<GitlabLockExecProof | undefined> {
    identity(execId);
    identity(containerId);
    const response = await this.transport.request('GET', `/exec/${execId}/json`);
    if (response.status === 404) return undefined;
    const proof = row(response.value);
    const process = row(proof.ProcessConfig);
    if (
      !/^[a-f0-9]{64}$/.test(digest) ||
      typeof process.user !== 'string' ||
      typeof process.entrypoint !== 'string' ||
      !Array.isArray(process.arguments) ||
      process.arguments.some((value) => typeof value !== 'string') ||
      process.privileged === true ||
      process.tty !== false ||
      proof.OpenStdin !== false ||
      proof.OpenStdout !== false ||
      proof.OpenStderr !== false ||
      createHash('sha256')
        .update(
          JSON.stringify({
            user: process.user,
            command: [process.entrypoint, ...process.arguments],
          }),
        )
        .digest('hex') !== digest
    )
      throw Error('gitlab-lock-exec-command-proof-invalid');
    if (
      response.status !== 200 ||
      proof.ID !== execId ||
      proof.ContainerID !== containerId ||
      typeof proof.Running !== 'boolean' ||
      (proof.ExitCode !== null && !Number.isSafeInteger(proof.ExitCode))
    )
      throw Error('gitlab-lock-exec-proof-invalid');
    return {
      id: execId,
      containerId,
      running: proof.Running,
      exitCode: proof.ExitCode as number | null,
    };
  }
  async start(
    execId: string,
    containerId: string,
    digest: string,
  ): Promise<GitlabLockExecProof | undefined> {
    // Docker serializes start on this exact Exec ID and refuses a second execution.
    if (!(await this.inspect(execId, containerId, digest))) return undefined;
    const response = await this.transport.request('POST', `/exec/${identity(execId)}/start`, {
      Detach: true,
      Tty: false,
    });
    if (response.status !== 200 && response.status !== 409)
      throw Error('gitlab-lock-exec-start-refused');
    return this.inspect(execId, containerId, digest);
  }
}
