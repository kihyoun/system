import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { StorageLease } from '../storage/lease';
import { lookupJob } from '../project-workflow/projectWorkflow';
import {
  environmentInputs,
  EnvironmentInputs,
  EnvironmentLeaseObservation,
  EnvironmentOperationLease,
  EnvironmentOperationLeasePort,
} from './ports';
import { object } from './settings';

function present(file: string): boolean {
  return !!fs.lstatSync(file, { throwIfNoEntry: false });
}
function observation(state: string): EnvironmentLeaseObservation | undefined {
  const upgrade = path.join(state, '.gitlab-upgrade-lock');
  const storage = path.join(state, '.storage-operation-lock');
  const kind = present(upgrade) ? 'gitlab-upgrade' : present(storage) ? 'storage' : undefined;

  if (!kind) {
    return undefined;
  }

  const directory = kind === 'storage' ? storage : upgrade;
  const unavailable: EnvironmentLeaseObservation = {
    kind,
    owner: 'unavailable',
    completion: 'unknown',
  };
  try {
    const stat = fs.lstatSync(directory);

    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return unavailable;
    }

    const file = path.join(directory, kind === 'storage' ? 'operation.json' : 'upgrade-owner.json');
    const owner = fs.lstatSync(file);

    if (
      !owner.isFile() ||
      owner.isSymbolicLink() ||
      owner.size > 65536 ||
      (owner.mode & 0o077) !== 0
    ) {
      return unavailable;
    }

    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));

    if (!object(value)) {
      return unavailable;
    }

    const operation =
      typeof value.operation === 'string' && /^[a-f0-9]{32}(?:[a-f0-9]{16})?$/.test(value.operation)
        ? value.operation
        : undefined;
    return {
      kind,
      owner:
        kind === 'storage' &&
        value.format === 'system-storage-operation-v1' &&
        value.helperName === 'wizard-environments' &&
        operation?.length === 48
          ? 'wizard-environments'
          : 'foreign',
      operation,
      completion:
        value.completion === 'running' || value.completion === 'uncertain'
          ? value.completion
          : 'unknown',
    };
  } catch {
    return unavailable;
  }
}

/** Only an in-process running job can make its own HTTP polling reentrant. */
export function environmentOwnsStorageLease(state: string): boolean {
  const value = observation(state);
  return (
    value?.kind === 'storage' &&
    value.owner === 'wizard-environments' &&
    value.completion === 'running' &&
    !!value.operation &&
    lookupJob(value.operation)?.state === 'running'
  );
}

@Injectable()
export class NativeEnvironmentOperationLeaseAdapter implements EnvironmentOperationLeasePort {
  constructor(@Inject(environmentInputs) private readonly inputs: EnvironmentInputs) {}

  observe(): EnvironmentLeaseObservation | undefined {
    return observation(path.dirname(this.inputs.mainFile()));
  }

  private busy(operation: string): Error {
    const owner = this.observe();
    return Object.assign(
      new Error(
        'storage-operation-busy [owner=' +
          (owner?.owner || 'unavailable') +
          '; operation=' +
          (owner?.operation || operation) +
          ']',
      ),
      { operation, ownership: owner },
    );
  }

  acquire(operation: string, helperImage: string): EnvironmentOperationLease {
    if (!/^[a-f0-9]{48}$/.test(operation) || !/^sha256:[a-f0-9]{64}$/.test(helperImage)) {
      throw new Error(
        'The environment reservation changed. Inspect the server-owned receipt before continuing.',
      );
    }

    if (this.observe()) {
      throw this.busy(operation);
    }

    const state = path.dirname(this.inputs.mainFile());
    let lease: StorageLease;
    try {
      lease = new StorageLease(state, {
        helperName: 'wizard-environments',
        operation,
        imageId: helperImage,
      });
    } catch {
      throw this.busy(operation);
    }
    const directory = fs.lstatSync(lease.directory),
      owner = fs.lstatSync(lease.owner);
    const bytes = fs.readFileSync(lease.owner);
    let finished = false;
    const handle: EnvironmentOperationLease = {
      finish: (safe: boolean) => {
        let owned = false;
        try {
          const actualDirectory = fs.lstatSync(lease.directory),
            actualOwner = fs.lstatSync(lease.owner);
          owned =
            !finished &&
            actualDirectory.isDirectory() &&
            !actualDirectory.isSymbolicLink() &&
            actualOwner.isFile() &&
            !actualOwner.isSymbolicLink() &&
            actualOwner.nlink === 1 &&
            directory.dev === actualDirectory.dev &&
            directory.ino === actualDirectory.ino &&
            directory.uid === actualDirectory.uid &&
            directory.gid === actualDirectory.gid &&
            directory.mode === actualDirectory.mode &&
            owner.dev === actualOwner.dev &&
            owner.ino === actualOwner.ino &&
            owner.uid === actualOwner.uid &&
            owner.gid === actualOwner.gid &&
            owner.mode === actualOwner.mode &&
            bytes.equals(fs.readFileSync(lease.owner)) &&
            fs.readdirSync(lease.directory).every((name) => name === 'operation.json');
        } catch {
          owned = false;
        }

        if (!owned) {
          throw Object.assign(this.busy(operation), { uncertain: true });
        }

        // The existing native format remains the barrier after an uncertain
        // transport or process loss. No timeout or status call adopts it.
        lease.release(safe);
        finished = true;
      },
    };

    if (present(path.join(state, '.gitlab-upgrade-lock'))) {
      handle.finish(true);
      throw this.busy(operation);
    }

    for (const selected of [lease.directory, state]) {
      const descriptor = fs.openSync(selected, fs.constants.O_RDONLY);
      try {
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }

    return handle;
  }
}
