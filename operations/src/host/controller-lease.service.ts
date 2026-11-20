import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { processStart, groupLive } from './guardian';
import { requireValue, writePrivate } from './install';

type Row = Record<string, unknown>;
export interface ControllerLeaseInput {
  root: string;
  seedDirectory?: string;
  legacyController?: { Mounts?: Array<{ Destination?: string; Type?: string; Source?: string }> };
}
function read(filename: string): Row {
  const stat = fs.lstatSync(filename);
  requireValue(
    stat.isFile() && !(stat.mode & 0o077) && stat.size <= 8 * 1024 ** 2,
    'private-controller-owner-required',
  );
  const value: unknown = JSON.parse(fs.readFileSync(filename, 'utf8'));
  requireValue(
    value && typeof value === 'object' && !Array.isArray(value),
    'invalid-controller-owner',
  );
  return value as Row;
}
const boot = () => fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
const publish = (filename: string, row: Row) =>
  writePrivate(filename, Buffer.from(JSON.stringify(row) + '\n'));

/** Durable cross-process ownership, retained after an uncertain critical operation. */
export class ControllerLeaseService {
  private descriptor?: number;
  private commandActive = false;
  private held: string[] = [];
  private paths: string[] = [];
  private legacySeed: string | null = null;
  private storageLease: unknown = 'live-v1';
  operation = '';
  critical = false;

  get guardFd(): number {
    requireValue(this.descriptor !== undefined, 'controller-lease-not-acquired');
    return this.descriptor!;
  }
  get journal(): string {
    requireValue(this.paths.length, 'controller-lease-not-acquired');
    return path.join(this.paths[0], 'host-child.json');
  }
  private initialize(input: ControllerLeaseInput): void {
    requireValue(
      this.descriptor === undefined && !this.held.length && path.isAbsolute(input.root),
      'invalid-controller-lease-state',
    );
    this.paths = [
      'configuration/.gitlab-upgrade-lock',
      'configuration/.storage-operation-lock',
      'host/letsencrypt/.system-bootstrapper-certificate-lock',
      'configuration/.projects.env/.wizard.env.environments.lock',
    ].map((name) => path.join(input.root, name));
    this.legacySeed = null;
    this.storageLease = 'live-v1';
    this.critical = false;
  }
  private seed(input: ControllerLeaseInput, selected: string): string {
    requireValue(path.isAbsolute(selected), 'legacy-controller-seed-binding-mismatch');
    const stat = fs.lstatSync(selected),
      resolved = fs.realpathSync(selected),
      root = fs.realpathSync(input.root);
    requireValue(
      stat.isDirectory() &&
        !stat.isSymbolicLink() &&
        input.seedDirectory &&
        fs.realpathSync(input.seedDirectory) === resolved &&
        resolved !== root &&
        !resolved.startsWith(root + path.sep) &&
        !root.startsWith(resolved + path.sep),
      'legacy-controller-seed-binding-mismatch',
    );
    return resolved;
  }
  private lock(root: string): void {
    const descriptor = fs.openSync(
      path.join(root, 'configuration/.controller-host-guard.lock'),
      fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = fs.fstatSync(descriptor);
      requireValue(
        stat.isFile() && stat.uid === process.geteuid?.() && !(stat.mode & 0o077),
        'private-controller-host-guard-required',
      );
      const result = spawnSync('flock', ['--exclusive', '--nonblock', '3'], {
        stdio: ['ignore', 'pipe', 'pipe', descriptor],
        timeout: 10000,
      });
      requireValue(
        !result.error && result.status === 0,
        'controller-host-command-or-coordinator-still-running',
      );
      this.descriptor = descriptor;
    } catch (error) {
      fs.closeSync(descriptor);
      throw error;
    }
  }
  private owner(): Row {
    return {
      format: 'system-controller-operation-v1',
      storageLease: this.storageLease,
      legacySeedDirectory: this.legacySeed,
      operation: this.operation,
      pid: process.pid,
      processStart: processStart(process.pid),
      bootId: boot(),
    };
  }
  acquire(input: ControllerLeaseInput): void {
    this.initialize(input);
    requireValue(
      !fs.existsSync(this.paths[0]) &&
        !fs.existsSync(
          path.join(input.root, 'gitlab/data/.system-bootstrapper-restore-incomplete'),
        ),
      'unfinished-GitLab-operation-blocks-controller-promotion',
    );
    const mounts =
      input.legacyController?.Mounts?.filter((row) => row.Destination === '/seed') ?? [];
    requireValue(mounts.length <= 1, 'ambiguous-legacy-controller-seed-binding');
    if (mounts.length) {
      requireValue(
        mounts[0].Type === 'bind' && mounts[0].Source,
        'legacy-controller-seed-binding-mismatch',
      );
      this.legacySeed = this.seed(input, mounts[0].Source!);
      this.paths.push(path.join(this.legacySeed, '.operation-lock'));
    }
    this.operation = randomUUID().replaceAll('-', '');
    this.lock(input.root);
    try {
      for (const directory of this.paths) {
        fs.mkdirSync(directory, { mode: 0o700 });
        // Record ownership before publishing; only our just-created directory can be removed on publication failure.
        try {
          publish(path.join(directory, 'controller-owner.json'), this.owner());
        } catch (error) {
          fs.rmdirSync(directory);
          throw error;
        }
        this.held.push(directory);
      }
    } catch (error) {
      this.release();
      throw error;
    }
  }
  adopt(input: ControllerLeaseInput, operation: string): void {
    this.initialize(input);
    requireValue(/^[a-f0-9]{32}$/.test(operation), 'invalid-controller-operation');
    this.operation = operation;
    this.critical = true;
    this.lock(input.root);
    try {
      const primary = read(path.join(this.paths[0], 'controller-owner.json'));
      this.storageLease = primary.storageLease;
      if (primary.storageLease !== 'live-v1') {
        requireValue(
          input.seedDirectory &&
            path.isAbsolute(input.seedDirectory) &&
            fs.statSync(input.seedDirectory).isDirectory(),
          'legacy-controller-seed-lease-unavailable',
        );
        this.paths[1] = path.join(input.seedDirectory!, '.operation-lock');
      } else if (primary.legacySeedDirectory) {
        requireValue(
          typeof primary.legacySeedDirectory === 'string',
          'legacy-controller-seed-lease-mismatch',
        );
        this.legacySeed = this.seed(input, primary.legacySeedDirectory as string);
        this.paths.push(path.join(this.legacySeed, '.operation-lock'));
      }
      if (fs.existsSync(this.journal)) {
        const child = read(this.journal);
        requireValue(child.operation === operation, 'controller-host-child-owner-mismatch');
        requireValue(
          child.bootId !== boot() ||
            (processStart(Number(child.guardianPid)) !== child.guardianStart &&
              (!child.childPid || processStart(Number(child.childPid)) !== child.childStart) &&
              !groupLive(Number(child.childPgid))),
          'controller-host-child-is-still-running',
        );
        if (child.phase !== 'completed')
          publish(this.journal, {
            ...child,
            phase: 'completed',
            interrupted: true,
            exitCode: null,
          });
      }
      for (const directory of this.paths) {
        const owner = read(path.join(directory, 'controller-owner.json'));
        requireValue(
          owner.format === 'system-controller-operation-v1' && owner.operation === operation,
          'controller-recovery-lease-ownership-mismatch',
        );
        requireValue(
          Number.isInteger(owner.pid) &&
            Number(owner.pid) > 0 &&
            typeof owner.processStart === 'string' &&
            /^\d+$/.test(owner.processStart),
          'invalid-controller-lease-process-identity',
        );
        requireValue(
          owner.bootId !== boot() || processStart(Number(owner.pid)) !== owner.processStart,
          'controller-operation-is-still-running',
        );
      }
      this.held = [...this.paths];
      for (const directory of this.held)
        publish(path.join(directory, 'controller-owner.json'), this.owner());
    } catch (error) {
      this.detach();
      this.held = [];
      throw error;
    }
  }
  /** Drop only the process attachment. Durable leases remain available for explicit recovery. */
  detach(): void {
    if (this.descriptor !== undefined) fs.closeSync(this.descriptor);
    this.descriptor = undefined;
  }
  release(): void {
    requireValue(!this.commandActive, 'controller-host-child-has-not-finished');
    if (fs.existsSync(this.journal)) {
      const child = read(this.journal);
      requireValue(
        child.operation === this.operation && child.phase === 'completed',
        'controller-host-child-has-not-finished',
      );
      fs.unlinkSync(this.journal);
    }
    for (const directory of [...this.held].reverse()) {
      const filename = path.join(directory, 'controller-owner.json');
      requireValue(
        read(filename).operation === this.operation,
        'controller-operation-lease-ownership-changed',
      );
      fs.unlinkSync(filename);
      fs.rmdirSync(directory);
      this.held.pop();
    }
    this.detach();
  }
  /** The guardian inherits the flock; timing out this caller never kills its owned worker. */
  command(
    command: string[],
    timeout = 300,
    input = Buffer.alloc(0),
    environment?: NodeJS.ProcessEnv,
  ): Promise<Buffer> {
    requireValue(
      command.length &&
        command.every((value) => typeof value === 'string') &&
        Number.isFinite(timeout) &&
        timeout > 0 &&
        timeout <= 1800 &&
        input.length <= 8 * 1024 ** 2,
      'invalid-controller-command',
    );
    requireValue(!this.commandActive, 'controller-host-child-has-not-finished');
    if (fs.existsSync(this.journal)) {
      const previous = read(this.journal);
      requireValue(
        previous.operation === this.operation && previous.phase === 'completed',
        'controller-host-child-has-not-finished',
      );
    }
    const guardFd = this.guardFd;
    this.commandActive = true;
    const child = spawn(
      process.execPath,
      [
        path.join(__dirname, 'guardian.js'),
        '--guard-fd',
        '3',
        '--journal',
        this.journal,
        '--operation',
        this.operation,
        '--timeout',
        String(timeout),
        '--',
        ...command,
      ],
      {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe', guardFd],
        env: environment,
      },
    );
    return new Promise((resolve, reject) => {
      const output: Buffer[] = [];
      let size = 0,
        overflow = false;
      const timer = setTimeout(
        () => {
          // Keep draining until the guardian finishes. Unref only permits an exiting
          // coordinator to leave the separately owned guardian and its flock alive.
          child.unref();
          for (const stream of [child.stdin, child.stdout, child.stderr])
            (stream as unknown as { unref?: () => void }).unref?.();
          reject(Error('owned-host-command-is-still-draining'));
        },
        (timeout + 30) * 1000,
      );
      child.stdout!.on('data', (bytes: Buffer) => {
        size += bytes.length;
        if (size <= 4 * 1024 ** 2) output.push(bytes);
        else overflow = true;
      });
      child.stderr!.resume();
      child.stdin!.on('error', () => {
        /* Exit status and durable journal determine outcome. */
      });
      child.once('error', () => {
        this.commandActive = false;
        clearTimeout(timer);
        reject(Error('controller-command-spawn-failed'));
      });
      child.once('close', (code) => {
        this.commandActive = false;
        clearTimeout(timer);
        if (code !== 0 || overflow) reject(Error('controller-command-failed'));
        else resolve(Buffer.concat(output));
      });
      child.stdin!.end(input);
    });
  }
  onModuleDestroy(): void {
    this.detach();
  }
  finish(failed: boolean): void {
    if (failed && this.critical) this.detach();
    else this.release();
  }
}
