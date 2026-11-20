import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { environmentAssignments } from '../runtime/environment-assignments';
import { cube } from '../host-bootstrap/runtime-verification.service';
import { requireValue as ensure, reference } from './install';
import { recoveryReference } from './recovery-manifest';
import { readPrivateSnapshot, readPrivateInput } from './private-input';
import { releaseInstalledSource } from './recovery-publication.service';
import { record } from '../release/source-identity';

type Row = Record<string, unknown>;
const names = ['.release-images.json', '.release-images.env'] as const;
export type SelectionName = (typeof names)[number];
export interface SelectionMetadata {
  sha256: string;
  mode: number;
  uid: number;
  gid: number;
}
export type SelectionState = Record<SelectionName, SelectionMetadata | null>;
export interface ReleaseSelection {
  before: SelectionState;
  after: SelectionState;
}
export const bytesSha = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
export function directoryBarrier(directory: string): void {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
/** Publish bytes with their retained owner already applied to the temporary inode. */
export function replaceOwned(
  filename: string,
  bytes: Buffer,
  metadata: { mode: number; uid: number; gid: number },
): void {
  ensure(
    [metadata.uid, metadata.gid, metadata.mode].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) && metadata.mode <= 0o7777,
    'invalid-retained-file-metadata',
  );
  const existing = fs.lstatSync(filename, { throwIfNoEntry: false });
  ensure(
    !existing || (existing.isFile() && !existing.isSymbolicLink()),
    'regular-owned-file-required',
  );
  const temporary = path.join(
    path.dirname(filename),
    '.' + path.basename(filename) + '.tmp-' + crypto.randomUUID(),
  );
  const fd = fs.openSync(
    temporary,
    fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.fchownSync(fd, metadata.uid, metadata.gid);
    fs.fchmodSync(fd, metadata.mode);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.renameSync(temporary, filename);
    directoryBarrier(path.dirname(filename));
  } finally {
    fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
/** Literal assignment editing preserves every unrelated byte, including the Cube and multiline secrets. */
export function imageAssignment(raw: Buffer, value: string, key = 'BOOTSTRAPPER_IMAGE'): Buffer {
  ensure(
    ['BOOTSTRAPPER_IMAGE', 'WIZARD_IMAGE'].includes(key),
    'unsupported-update-image-assignment',
  );
  if (!/^system-bootstrapper-recovery:[a-f0-9]{64}$/.test(value)) reference(value);
  cube(raw);
  ensure(
    Buffer.from(raw.toString('utf8')).equals(raw),
    'unsupported-controller-update-configuration',
  );
  const matches: Array<[number, number]> = [];
  let start = 0,
    offset = 0,
    quote = 0,
    pending = false;
  for (const line of raw.toString('utf8').match(/[^\n]*\n|[^\n]+$/g) || []) {
    const bytes = Buffer.from(line),
      end = offset + bytes.length;
    if (!pending && (!line.trim() || line.trimStart().startsWith('#'))) {
      offset = end;
      continue;
    }
    if (!pending) start = offset;
    pending = true;
    let escaped = false;
    const content = line.endsWith('\n') ? bytes.subarray(0, -1) : bytes;
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (escaped) escaped = false;
      else if (quote === 39) {
        if (char === 39) quote = 0;
      } else if (char === 92) escaped = true;
      else if (char === quote) quote = 0;
      else if (!quote && [34, 39].includes(char)) quote = char;
      else if (!quote && char === 35 && (i === 0 || [32, 9].includes(content[i - 1]))) break;
    }
    offset = end;
    if (quote || escaped) continue;
    const assignment = environmentAssignments(raw.subarray(start, end).toString('utf8'));
    const keys = Object.keys(assignment);
    ensure(keys.length === 1, 'unsupported-controller-update-configuration');
    if (keys[0] === key) {
      ensure(recoveryReference(assignment[key]), 'invalid-existing-image-assignment');
      if (
        key === 'BOOTSTRAPPER_IMAGE' &&
        !/^system-bootstrapper-recovery:[a-f0-9]{64}$/.test(assignment[key])
      )
        reference(assignment[key]);
      matches.push([start, end]);
    }
    pending = false;
  }
  ensure(!pending, 'incomplete-controller-update-configuration');
  ensure(
    matches.length <= 1 && matches.every(([start]) => start >= 1184),
    'duplicate-or-header-controller-assignment',
  );
  const line = Buffer.from(`export ${key}='${value}'`);
  const result = matches.length
    ? Buffer.concat([
        raw.subarray(0, matches[0][0]),
        line,
        raw[matches[0][1] - 1] === 10 ? Buffer.from('\n') : Buffer.alloc(0),
        raw.subarray(matches[0][1]),
      ])
    : Buffer.concat([
        raw,
        raw.at(-1) === 10 ? Buffer.alloc(0) : Buffer.from('\n'),
        line,
        Buffer.from('\n'),
      ]);
  cube(result);
  return result;
}
export class ReleaseSelectionService {
  read(configuration: string): {
    state: SelectionState;
    payloads: Partial<Record<SelectionName, Buffer>>;
  } {
    const state = {} as SelectionState,
      payloads: Partial<Record<SelectionName, Buffer>> = {};
    for (const name of names) {
      const filename = path.join(path.dirname(configuration), name);
      if (!fs.lstatSync(filename, { throwIfNoEntry: false })) {
        state[name] = null;
        continue;
      }
      const { bytes, stat } = readPrivateSnapshot(filename);
      state[name] = {
        sha256: bytesSha(bytes),
        mode: stat.mode & 0o7777,
        uid: stat.uid,
        gid: stat.gid,
      };
      payloads[name] = bytes;
    }
    return { state, payloads };
  }
  prepare(configuration: string, accepted: Row, release: Row, controller: Row, wizard: Row) {
    const { state: before, payloads: previous } = this.read(configuration);
    ensure(
      names.every((name) => before[name] === null) || names.every((name) => before[name] !== null),
      'public-release-selection-incomplete',
    );
    const receipt = {
      schemaVersion: 1,
      ...releaseInstalledSource(release),
      images: { controller, wizard },
      status: 'selected',
      selectedAt: new Date().toISOString(),
      productRelease: {
        version: accepted.version,
        tag: accepted.tag,
        sourceRevision: record(accepted.source).revision,
      },
      selectionOperation: 'accepted-public-controller-update',
    };
    const payloads = {
      '.release-images.json': Buffer.from(JSON.stringify(receipt, null, 2) + '\n'),
      '.release-images.env': Buffer.from(
        'BOOTSTRAPPER_IMAGE=' + controller.reference + '\nWIZARD_IMAGE=' + wizard.reference + '\n',
      ),
    };
    const after = {} as SelectionState;
    for (const name of names)
      after[name] = {
        ...(before[name] ?? { mode: 0o600, uid: process.geteuid!(), gid: process.getegid!() }),
        sha256: bytesSha(payloads[name]),
      };
    return { selection: { before, after }, previous, payloads };
  }
  verify(configuration: string, selection: ReleaseSelection, rollback = false): void {
    const { state } = this.read(configuration);
    for (const name of names)
      ensure(
        isDeepStrictEqual(state[name], selection.before[name]) ||
          (rollback && isDeepStrictEqual(state[name], selection.after[name])),
        'public-release-selection-changed',
      );
  }
  verifyCheckpoint(checkpoint: string, selection: ReleaseSelection): void {
    for (const phase of ['before', 'after'] as const)
      for (const name of names) {
        const metadata = selection[phase][name];
        if (metadata)
          ensure(
            bytesSha(readPrivateInput(path.join(checkpoint, name + '.' + phase))) ===
              metadata.sha256,
            'public-release-selection-checkpoint-changed',
          );
      }
  }
  write(
    configuration: string,
    checkpoint: string,
    selection: ReleaseSelection,
    phase: 'before' | 'after',
  ): void {
    for (const name of names) {
      const filename = path.join(path.dirname(configuration), name),
        metadata = selection[phase][name];
      if (!metadata) {
        if (fs.lstatSync(filename, { throwIfNoEntry: false })) {
          fs.unlinkSync(filename);
          directoryBarrier(path.dirname(filename));
        }
        continue;
      }
      const bytes = readPrivateInput(path.join(checkpoint, name + '.' + phase));
      ensure(bytesSha(bytes) === metadata.sha256, 'public-release-selection-checkpoint-changed');
      replaceOwned(filename, bytes, metadata);
    }
  }
}
