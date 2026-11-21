import fs from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { LifecycleProcess } from '../runtime/managed-child';
export const GITLAB_PROVISION_PROCESS = Symbol('GITLAB_PROVISION_PROCESS');
export interface GitlabNativeContext {
  checkout: string;
  containerId: string;
  signal?: AbortSignal;
}
export interface GitlabApiResult {
  status: number;
  value: unknown;
}
export type GitlabMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
function context(value: GitlabNativeContext): void {
  if (!path.isAbsolute(value.checkout) || !/^[a-f0-9]{64}$/.test(value.containerId))
    throw Error('gitlab-native-exact-context-required');
}
/** Fixed local GitLab origin; private input is never part of argv or diagnostic errors. */
@Injectable()
export class GitlabNativeApiService {
  constructor(@Inject(GITLAB_PROVISION_PROCESS) private readonly child: LifecycleProcess) {}
  private run(
    value: GitlabNativeContext,
    args: string[],
    input?: string,
    timeout = 65000,
    maxBytes = 2 * 1024 * 1024,
  ) {
    context(value);
    return this.child.run(
      'docker',
      [
        '--host=unix:///var/run/docker.sock',
        'exec',
        ...(input === undefined ? [] : ['-i']),
        value.containerId,
        ...args,
      ],
      {
        cwd: value.checkout,
        env: process.env,
        signal: value.signal,
        input,
        timeout,
        maxBuffer: maxBytes,
      },
    );
  }
  async bootstrap(value: GitlabNativeContext, operation: string): Promise<unknown> {
    context(value);
    if (!/^[a-f0-9]{48}$/.test(operation)) throw Error('gitlab-bootstrap-operation-required');
    const script = fs.readFileSync(
      path.join(value.checkout, 'tools/gitlab/bootstrap-token.rb'),
      'utf8',
    );
    let output: string;
    try {
      output = await this.run(
        value,
        ['env', `SYSTEM_BOOTSTRAPPER_AUTH_OPERATION=${operation}`, 'gitlab-rails', 'runner', '-'],
        script,
        240000,
      );
      return JSON.parse(output.trim().split('\n').at(-1)!);
    } catch {
      throw Object.assign(Error('gitlab-bootstrap-outcome-uncertain'), { uncertain: true });
    }
  }
  async request(
    value: GitlabNativeContext,
    token: string,
    method: GitlabMethod,
    route: string,
    body?: unknown,
  ): Promise<GitlabApiResult> {
    // Repository files include base64-encoded generated documentation. Keep the
    // larger read bound specific to this endpoint; ordinary API results and all
    // writes retain the smaller transport limit.
    const maxBytes =
      method === 'GET' && /^projects\/[^/]+\/repository\/files\//.test(route)
        ? 8 * 1024 * 1024
        : 2 * 1024 * 1024;
    const response = await this.exchange(value, token, method, route, body, maxBytes);
    try {
      return {
        status: response.status,
        value: response.bytes.length ? JSON.parse(response.bytes.toString('utf8')) : null,
      };
    } catch {
      throw Object.assign(Error('gitlab-native-response-invalid'), { uncertain: method !== 'GET' });
    }
  }
  /** Read-only artifact bytes retain the hash identity emitted by the CI job. */
  async readBytes(value: GitlabNativeContext, token: string, route: string) {
    return this.exchange(value, token, 'GET', route, undefined, 8 * 1024 * 1024);
  }
  private async exchange(
    value: GitlabNativeContext,
    token: string,
    method: GitlabMethod,
    route: string,
    body?: unknown,
    maxBytes = 2 * 1024 * 1024,
  ): Promise<{ status: number; bytes: Buffer }> {
    context(value);
    if (
      !token ||
      /[\r\n\0]/.test(token) ||
      !['GET', 'POST', 'PUT', 'DELETE'].includes(method) ||
      !/^[A-Za-z0-9][A-Za-z0-9_./?%=&+*-]*$/.test(route) ||
      route.split(/[/?]/).includes('..') ||
      /%0[ad]/i.test(route)
    )
      throw Error('gitlab-native-request-invalid');
    const configuration =
      `header = ${JSON.stringify('PRIVATE-TOKEN: ' + token)}\nheader = "Content-Type: application/json"\n` +
      (body === undefined ? '' : `data-binary = ${JSON.stringify(JSON.stringify(body))}\n`);
    let output: string;
    try {
      output = await this.run(
        value,
        [
          'curl',
          '-q',
          '--proxy',
          '',
          '--silent',
          '--show-error',
          '--proto',
          '=http',
          '--max-time',
          '60',
          '--max-filesize',
          String(maxBytes),
          '--request',
          method,
          '--config',
          '-',
          '--write-out',
          '\nBOOTSTRAPPER_HTTP_STATUS:%{http_code}',
          '--url',
          'http://127.0.0.1/api/v4/' + route,
        ],
        configuration,
        65000,
        maxBytes + 128,
      );
    } catch {
      throw Object.assign(Error('gitlab-native-request-incomplete'), {
        uncertain: method !== 'GET',
      });
    }
    const match = /\nBOOTSTRAPPER_HTTP_STATUS:([1-5][0-9]{2})$/.exec(output);
    if (!match || (Number(match[1]) >= 300 && Number(match[1]) < 400))
      throw Object.assign(Error('gitlab-native-response-invalid'), { uncertain: method !== 'GET' });
    const bytes = Buffer.from(output.slice(0, match.index));
    if (bytes.length > maxBytes) throw Error('gitlab-native-response-too-large');
    return { status: Number(match[1]), bytes };
  }
}
