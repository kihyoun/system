import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StorageSpec, MountRow, requireValue } from './types';
export function startupAllowed(
  state: string,
  staged = process.env.SYSTEM_BOOTSTRAPPER_STAGED_CONTROLLER === '1',
) {
  const lock = path.join(state, '.storage-operation-lock');
  const upgrade = path.join(state, '.gitlab-upgrade-lock');
  if (
    !fs.lstatSync(lock, { throwIfNoEntry: false }) &&
    !fs.lstatSync(upgrade, { throwIfNoEntry: false })
  )
    return;
  requireValue(staged, 'storage-operation-busy');
  let identity;
  for (const directory of [lock, upgrade]) {
    requireValue(
      fs.lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() &&
        !fs.existsSync(path.join(directory, 'operation.json')) &&
        !fs.existsSync(path.join(directory, 'upgrade-owner.json')),
      'storage-operation-busy',
    );
    const owner = path.join(directory, 'controller-owner.json');
    requireValue(
      fs.lstatSync(owner, { throwIfNoEntry: false })?.isFile() &&
        !fs.lstatSync(owner).isSymbolicLink(),
      'storage-operation-busy',
    );
    let record;
    try {
      record = JSON.parse(fs.readFileSync(owner, 'utf8'));
    } catch {
      throw Error('storage-operation-busy');
    }
    requireValue(
      record.format === 'system-controller-operation-v1' &&
        /^[a-f0-9]{32}$/.test(record.operation) &&
        (!identity || JSON.stringify(record) === identity),
      'storage-operation-busy',
    );
    identity = JSON.stringify(record);
  }
  requireValue(identity, 'storage-operation-busy');
  return JSON.parse(identity);
}
export function startupBegin(state: string, pid: string | number) {
  const promotion = startupAllowed(state);
  if (promotion) return 'staged-' + promotion.operation;
  requireValue(/^[1-9][0-9]*$/.test(String(pid)), 'invalid-startup-owner');
  const directory = path.join(state, '.storage-operation-lock'),
    operation = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch {
    throw Error('storage-operation-busy');
  }
  fs.writeFileSync(
    path.join(directory, 'startup-owner.json'),
    JSON.stringify({ format: 'system-controller-startup-v1', operation, pid: Number(pid) }) + '\n',
    { mode: 0o600, flag: 'wx', flush: true },
  );
  return 'startup-' + operation;
}
export function startupFinish(state: string, operation: string | undefined) {
  requireValue(
    operation && /^(startup|staged)-[a-f0-9]{32}$/.test(operation),
    'invalid-startup-owner',
  );
  if (operation.startsWith('staged-')) {
    const promotion = startupAllowed(state);
    requireValue(promotion?.operation === operation.slice(7), 'startup-ownership-changed');
    return;
  }
  const directory = path.join(state, '.storage-operation-lock'),
    owner = path.join(directory, 'startup-owner.json');
  requireValue(
    fs.lstatSync(directory).isDirectory() &&
      fs.lstatSync(owner).isFile() &&
      !fs.lstatSync(owner).isSymbolicLink(),
    'startup-ownership-changed',
  );
  const record = JSON.parse(fs.readFileSync(owner, 'utf8'));
  requireValue(
    record.format === 'system-controller-startup-v1' && record.operation === operation.slice(8),
    'startup-ownership-changed',
  );
  fs.unlinkSync(owner);
  fs.rmdirSync(directory);
}
export function startupSettled(
  state: string,
  operation: string | undefined,
  exitCode: number | null,
) {
  // Signals and killed/unknown children retain the barrier. A cleanly ended
  // startup attempt may retry without erasing a subsequent operation's lease.
  if (
    exitCode === null ||
    !operation ||
    !Number.isInteger(exitCode) ||
    exitCode < 0 ||
    exitCode >= 128 ||
    !/^startup-[a-f0-9]{32}$/.test(operation || '')
  )
    return;
  const owner = path.join(state, '.storage-operation-lock/startup-owner.json');
  if (!fs.lstatSync(owner, { throwIfNoEntry: false })) return;
  requireValue(
    fs.lstatSync(owner).isFile() && !fs.lstatSync(owner).isSymbolicLink(),
    'startup-ownership-changed',
  );
  const record = JSON.parse(fs.readFileSync(owner, 'utf8'));
  if (record.operation === operation.slice(8)) startupFinish(state, operation);
}
export class StorageLease {
  spec: StorageSpec;
  directory: string;
  owner: string;
  environment: string;
  environmentHeld: boolean;
  constructor(state: string, spec: StorageSpec) {
    this.spec = spec;
    this.directory = path.join(state, '.storage-operation-lock');
    this.owner = path.join(this.directory, 'operation.json');
    this.environment = path.join(state, '.projects.env/.wizard.env.environments.lock');
    this.environmentHeld = false;
    try {
      fs.mkdirSync(this.directory, { mode: 0o700 });
    } catch {
      throw Error('storage-operation-busy');
    }
    this.record('running');
  }
  record(completion: 'running' | 'uncertain') {
    fs.writeFileSync(
      this.owner,
      JSON.stringify({
        format: 'system-storage-operation-v1',
        helperName: this.spec.helperName,
        imageId: this.spec.imageId,
        operation: this.spec.operation,
        completion,
      }) + '\n',
      { mode: 0o600, flush: true },
    );
  }
  acquireEnvironment() {
    fs.mkdirSync(path.dirname(this.environment), { recursive: true, mode: 0o700 });
    try {
      fs.mkdirSync(this.environment, { mode: 0o700 });
    } catch {
      throw Error('storage-operation-busy');
    }
    this.environmentHeld = true;
  }
  release(safe: boolean) {
    if (!safe) {
      this.record('uncertain');
      return;
    }
    if (this.environmentHeld) fs.rmdirSync(this.environment);
    fs.unlinkSync(this.owner);
    fs.rmdirSync(this.directory);
  }
}
