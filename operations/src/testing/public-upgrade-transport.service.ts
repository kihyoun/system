import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const fixtureRuntime = '/opt/system-public-upgrade';
export const runtimeLibraries = [
  '/lib/ld-musl-x86_64.so.1',
  '/usr/lib/libstdc++.so.6',
  '/usr/lib/libgcc_s.so.1',
];
export type TransportResult = { status: number; signal?: NodeJS.Signals };
class FixtureRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
/** Test-only publication transport; never imported by production operation modules. */
@Injectable()
export class PublicUpgradeTransportService {
  private async execute(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    inspect?: string,
  ): Promise<TransportResult> {
    const result = await new Promise<{ status: number; signal?: NodeJS.Signals; stdout: Buffer }>(
      (resolve) => {
        const child = spawn(command, args, {
          env,
          stdio: inspect ? ['inherit', 'pipe', 'inherit'] : 'inherit',
        });
        const chunks: Buffer[] = [];
        let bytes = 0,
          failure = 0;
        const interrupt = () => child.kill('SIGINT'),
          terminate = () => child.kill('SIGTERM');
        process.on('SIGINT', interrupt);
        process.on('SIGTERM', terminate);
        child.stdout?.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 64 * 1024 * 1024) {
            failure = 126;
            child.kill('SIGKILL');
          } else chunks.push(chunk);
        });
        child.on('error', (error: NodeJS.ErrnoException) => {
          failure = error.code === 'ENOENT' ? 127 : 126;
        });
        child.on('close', (status, signal) => {
          process.off('SIGINT', interrupt);
          process.off('SIGTERM', terminate);
          resolve({
            status: failure || (status ?? 1),
            signal: failure ? undefined : (signal ?? undefined),
            stdout: Buffer.concat(chunks),
          });
        });
      },
    );
    if (result.signal) return { status: 1, signal: result.signal };
    if (result.status !== 0) return { status: result.status };
    if (inspect) {
      let output = result.stdout.toString();
      try {
        const parsed: unknown = JSON.parse(output);
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        for (const row of rows) {
          if (typeof row === 'object' && row !== null && Object.hasOwn(row, 'RepoDigests'))
            (row as Record<string, unknown>).RepoDigests = [inspect];
        }
        output = JSON.stringify(parsed) + '\n';
      } catch {
        /* Native formatted output that is not JSON stays byte-for-byte intact. */
      }
      process.stdout.write(output);
    }
    return { status: 0 };
  }
  async docker(
    program: string,
    input: string[],
    environment = process.env,
  ): Promise<TransportResult> {
    const fixture = environment.SYSTEM_PUBLIC_UPGRADE_FIXTURE;
    if (!fixture) throw Error('public-upgrade-fixture-required');
    const env = { ...environment };
    const rows = fs
      .readFileSync(path.join(fixture, 'images.tsv'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t'));
    const map = (value: string) => {
      const normalized = value.replace(/^docker.io\//, '');
      const row = rows.find((row) => row[0] === normalized);
      if (!row) return value;
      if (row[2] === 'previous' && fs.existsSync(path.join(fixture, 'offline-recovery')))
        throw new FixtureRefusal(87, 'Previous public registry transport is unavailable.');
      return row[1];
    };
    try {
      let args = [...input];
      const commandOffset = args[0] === '--host=unix:///var/run/docker.sock' ? 1 : 0;
      if (path.basename(program) === 'docker-compose' || args[commandOffset] === 'compose') {
        if (path.basename(program) !== 'docker-compose') args = args.slice(commandOffset + 1);
        for (const key of ['BOOTSTRAPPER_IMAGE', 'WIZARD_IMAGE'])
          if (env[key]) env[key] = map(env[key]!);
        if (args.some((value) => value.endsWith('system/docker-compose.yml'))) {
          const index = args.findIndex((value) => value === 'up' || value === 'create');
          if (index >= 0) args.splice(index, 0, '-f', path.join(fixture, 'compose.yml'));
        }
        if (
          env.BOOTSTRAPPER_IMAGE?.startsWith('system-bootstrapper-recovery:') &&
          args.at(-1) === 'bootstrapper'
        ) {
          try {
            fs.unlinkSync(path.join(fixture, 'fail-recovery-once'));
            throw new FixtureRefusal(88, 'Injected one-shot recovery transport failure.');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
        return this.execute(path.join(fixture, 'docker-compose.native'), args, env);
      }
      let original: string | undefined;
      args = args.map((value) => {
        const mapped = map(value);
        if (mapped !== value) original = value.replace(/^docker.io\//, '');
        return mapped;
      });
      if (original && args[commandOffset] === 'pull')
        return this.execute(
          path.join(fixture, 'docker.native'),
          ['image', 'inspect', args.at(-1)!],
          env,
        );
      const inspect =
        original && args[commandOffset] === 'image' && args[commandOffset + 1] === 'inspect'
          ? original
          : undefined;
      return this.execute(path.join(fixture, 'docker.native'), args, env, inspect);
    } catch (error) {
      if (!(error instanceof FixtureRefusal)) throw error;
      process.stderr.write(error.message + '\n');
      return { status: error.status };
    }
  }
  async findmnt(args: string[], environment = process.env): Promise<TransportResult> {
    const live = environment.SYSTEM_PUBLIC_UPGRADE_LIVE;
    if (!live) throw Error('public-upgrade-live-required');
    let target = '',
      field = '';
    for (let index = 0; index < args.length; index++) {
      if (['--target', '-T'].includes(args[index])) target = args[++index] || '';
      else if (args[index] === '-o') field = args[++index] || '';
    }
    if (target === '/' || target === live || target.startsWith(live + '/')) {
      const output: Record<string, string> = { 'MAJ:MIN': '0:1\n', UUID: '\n', TARGET: '/\n' };
      if (Object.hasOwn(output, field)) {
        process.stdout.write(output[field]);
        return { status: 0 };
      }
    }
    return this.execute('/usr/bin/findmnt', args, environment);
  }
}
