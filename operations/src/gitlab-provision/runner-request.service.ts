import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { readPrivateInput } from '../host/private-input';
import { GitlabLockExecService } from './lock-exec.service';

export interface GitlabRunnerRequest {
  nonce: string;
  identity: string;
  containerId: string;
  exec?: { id: string; digest: string };
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** Called under the runner journal's existing flock, with the verified shared config mount. */
@Injectable()
export class GitlabRunnerRequestService {
  constructor(private readonly executions: GitlabLockExecService) {}

  async execute(input: {
    containerId: string;
    configDirectory: string;
    token: string;
    route: string;
    body: Record<string, unknown>;
    pending?: GitlabRunnerRequest;
    save: (request: GitlabRunnerRequest) => void;
    signal?: AbortSignal;
  }): Promise<{ status: number; value: unknown }> {
    if (
      !/^[a-f0-9]{64}$/.test(input.containerId) ||
      !/^(?:user\/runners|runners\/[1-9][0-9]*\/reset_authentication_token)$/.test(input.route) ||
      !/^[A-Za-z0-9_.-]{1,4096}$/.test(input.token)
    )
      throw Error('gitlab-runner-request-invalid');
    const identity = digest(JSON.stringify({ route: input.route, body: input.body }));
    const state = input.pending ?? {
      nonce: randomBytes(24).toString('hex'),
      identity,
      containerId: input.containerId,
    };
    if (
      !/^[a-f0-9]{48}$/.test(state.nonce) ||
      state.identity !== identity ||
      state.containerId !== input.containerId
    )
      throw Error('gitlab-runner-request-identity-mismatch');
    const owner = process.getuid!();
    const parent = path.join(input.configDirectory, 'system-bootstrapper-auth');
    if (!path.isAbsolute(input.configDirectory) || fs.realpathSync(parent) !== parent)
      throw Error('gitlab-runner-request-directory-invalid');
    this.directory(parent, owner);
    const directory = path.join(parent, 'runner-request-' + state.nonce);
    // Intent is durable before creating an exec, which itself does not start anything.
    if (!input.pending) input.save(state);
    if (!state.exec) {
      if (!fs.existsSync(directory)) fs.mkdirSync(directory, { mode: 0o700 });
      this.directory(directory, owner);
      // An exec with no journalled ID cannot have been started by this service.
      for (const name of ['request', 'response', 'headers']) {
        const filename = path.join(directory, name);
        if (fs.existsSync(filename)) {
          readPrivateInput(filename, 65536, { owner, mode: 0o600 });
          fs.unlinkSync(filename);
        }
      }
      const config =
        'header = ' +
        JSON.stringify('PRIVATE-TOKEN: ' + input.token) +
        '\n' +
        'header = "Content-Type: application/json"\n' +
        'data = ' +
        JSON.stringify(JSON.stringify(input.body)) +
        '\n';
      if (Buffer.byteLength(config) > 65536) throw Error('gitlab-runner-request-too-large');
      for (const [name, content] of [
        ['request', config],
        ['response', ''],
        ['headers', ''],
      ]) {
        const fd = fs.openSync(path.join(directory, name), 'wx', 0o600);
        try {
          fs.writeFileSync(fd, content);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
      this.sync(directory);
      this.sync(parent);
      state.exec = await this.executions.createRunnerRequest(
        input.containerId,
        `${owner}:${process.getgid!()}`,
        state.nonce,
        input.route,
      );
      input.save(state);
    }
    this.directory(directory, owner);
    let proof = await this.executions.inspect(state.exec.id, input.containerId, state.exec.digest);
    if (!proof) throw Error('gitlab-runner-request-exec-missing-reconciliation-required');
    if (!proof.running)
      proof = await this.executions.start(state.exec.id, input.containerId, state.exec.digest);
    const deadline = Date.now() + 65000;
    while (proof?.running && Date.now() < deadline) {
      await delay(100, undefined, { signal: input.signal });
      proof = await this.executions.inspect(state.exec.id, input.containerId, state.exec.digest);
    }
    if (!proof || proof.running || proof.exitCode !== 0)
      throw Error('gitlab-runner-request-incomplete-reconciliation-required');
    const headers = readPrivateInput(path.join(directory, 'headers'), 65536, {
      owner,
      mode: 0o600,
    }).toString('utf8');
    const body = readPrivateInput(path.join(directory, 'response'), 65536, { owner, mode: 0o600 });
    const statuses = [...headers.matchAll(/^HTTP\/1\.[01] ([0-9]{3})[^\r\n]*\r?$/gm)];
    const status = Number(statuses.at(-1)?.[1]);
    if (!status || (status >= 300 && status < 400))
      throw Error('gitlab-runner-request-response-invalid');
    let value: unknown;
    try {
      value = JSON.parse(body.toString('utf8'));
    } catch {
      throw Error('gitlab-runner-request-response-invalid');
    }
    // Preserve the response before the caller verifies the token and clears pending.
    for (const name of ['headers', 'response']) {
      const fd = fs.openSync(
        path.join(directory, name),
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    this.sync(directory);
    return { status, value };
  }
  private directory(directory: string, owner: number): void {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.uid !== owner || (stat.mode & 0o777) !== 0o700)
      throw Error('gitlab-runner-request-directory-invalid');
  }
  private sync(directory: string): void {
    const fd = fs.openSync(
      directory,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
    );
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
}
