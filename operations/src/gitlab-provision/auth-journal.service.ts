import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileLock } from '../runtime/file-lock';

export interface GitlabAuthJournal {
  version: 1;
  operation: string;
  phase: 'bootstrap-requested' | 'bootstrap-received' | 'replacement-verified' | 'ready';
  account?: { username: string; email: string; nonce: string; userId?: number };
  pendingToken?: { name: string; expiresAt: string };
  bootstrap?: { id: number; userId: number; token: string; name: string; expiresAt: string };
  replacement?: { id: number; userId: number; token: string; expiresAt: string };
  renewal?: { id: number; userId: number; token: string; expiresAt: string };
  retiring?: { id: number; userId: number; token: string; expiresAt: string };
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('gitlab-auth-journal-invalid');
  return value as Record<string, unknown>;
}
function secret(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length < 4096 && !/[\r\n\0]/.test(value)
  );
}
function credential(value: unknown): Record<string, unknown> {
  const result = record(value);
  if (
    !Number.isSafeInteger(result.id) ||
    Number(result.id) <= 0 ||
    !Number.isSafeInteger(result.userId) ||
    Number(result.userId) <= 0 ||
    !secret(result.token) ||
    typeof result.expiresAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(result.expiresAt)
  )
    throw Error('gitlab-auth-journal-invalid');
  return result;
}
export function validateAuthJournal(value: unknown): GitlabAuthJournal {
  const state = record(value);
  if (
    state.version !== 1 ||
    typeof state.operation !== 'string' ||
    !/^[a-f0-9]{48}$/.test(state.operation) ||
    !['bootstrap-requested', 'bootstrap-received', 'replacement-verified', 'ready'].includes(
      String(state.phase),
    )
  )
    throw Error('gitlab-auth-journal-invalid');
  if (state.account !== undefined) {
    const account = record(state.account);
    if (
      typeof account.username !== 'string' ||
      !/^[a-z][a-z0-9_.-]{2,63}$/.test(account.username) ||
      typeof account.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+$/.test(account.email) ||
      typeof account.nonce !== 'string' ||
      !/^[a-f0-9]{48}$/.test(account.nonce) ||
      (account.userId !== undefined &&
        (!Number.isSafeInteger(account.userId) || Number(account.userId) <= 0))
    )
      throw Error('gitlab-auth-journal-invalid');
  }
  if (state.pendingToken !== undefined) {
    const pending = record(state.pendingToken);
    if (
      !state.account ||
      typeof pending.name !== 'string' ||
      !/^system-bootstrapper-controller-[a-f0-9]{48}$/.test(pending.name) ||
      typeof pending.expiresAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(pending.expiresAt)
    )
      throw Error('gitlab-auth-journal-invalid');
  }
  if (
    state.bootstrap !== undefined &&
    credential(state.bootstrap).name !== 'system-bootstrapper-initial-' + state.operation
  )
    throw Error('gitlab-auth-journal-invalid');
  if (state.replacement !== undefined) credential(state.replacement);
  for (const field of ['renewal', 'retiring'])
    if (state[field] !== undefined) {
      credential(state[field]);
      if (state.phase !== 'ready' || !state.account) throw Error('gitlab-auth-journal-invalid');
    }
  if (
    (state.phase === 'bootstrap-received' || state.phase === 'replacement-verified') &&
    !state.bootstrap
  )
    throw Error('gitlab-auth-journal-invalid');
  if ((state.phase === 'replacement-verified' || state.phase === 'ready') && !state.replacement)
    throw Error('gitlab-auth-journal-invalid');
  if (state.phase === 'ready' && state.bootstrap) throw Error('gitlab-auth-journal-invalid');
  return state as unknown as GitlabAuthJournal;
}
export interface GitlabAuthJournalSession {
  read(): GitlabAuthJournal | undefined;
  save(value: GitlabAuthJournal): void;
}
/** Private state shares the GitLab configuration volume and its Harvest/Seed lifecycle. */
@Injectable()
export class GitlabAuthJournalService {
  async withJournal<T>(
    configDirectory: string,
    operation: (journal: GitlabAuthJournalSession) => Promise<T>,
  ): Promise<T> {
    if (
      !path.isAbsolute(configDirectory) ||
      fs.realpathSync(configDirectory) !== configDirectory ||
      !fs.statSync(configDirectory).isDirectory()
    )
      throw Error('gitlab-auth-config-directory-invalid');
    const syncDirectory = (target: string) => {
      const fd = fs.openSync(
        target,
        fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW,
      );
      try {
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    };
    const directory = path.join(configDirectory, 'system-bootstrapper-auth');
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const checkStat = (stat: fs.Stats, directoryExpected = false) => {
      if (
        (directoryExpected ? !stat.isDirectory() : !stat.isFile()) ||
        stat.uid !== process.getuid?.() ||
        (stat.mode & 0o777) !== (directoryExpected ? 0o700 : 0o600) ||
        (!directoryExpected && stat.nlink !== 1)
      )
        throw Error('gitlab-auth-private-state-invalid');
    };
    const checked = (filename: string, directoryExpected = false) =>
      checkStat(fs.lstatSync(filename), directoryExpected);
    checked(directory, true);
    syncDirectory(configDirectory);
    const lock = path.join(directory, 'journal.lock');
    try {
      const fd = fs.openSync(
        lock,
        fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY,
        0o600,
      );
      fs.closeSync(fd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    checked(lock);
    const release = fileLock(lock);
    const filename = path.join(directory, 'journal.json');
    try {
      return await operation({
        read: () => {
          try {
            checked(filename);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw error;
          }
          const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
          try {
            const stat = fs.fstatSync(fd);
            checkStat(stat);
            if (stat.size > 65536) throw Error('gitlab-auth-journal-invalid');
            return validateAuthJournal(JSON.parse(fs.readFileSync(fd, 'utf8')));
          } catch {
            throw Error('gitlab-auth-journal-invalid');
          } finally {
            fs.closeSync(fd);
          }
        },
        save: (value) => {
          validateAuthJournal(value);
          try {
            checked(filename);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          const temporary = path.join(directory, '.journal-' + randomBytes(24).toString('hex'));
          const fd = fs.openSync(
            temporary,
            fs.constants.O_WRONLY |
              fs.constants.O_CREAT |
              fs.constants.O_EXCL |
              fs.constants.O_NOFOLLOW,
            0o600,
          );
          let closed = false;
          let failed = false;
          try {
            fs.writeFileSync(fd, JSON.stringify(value) + '\n');
            fs.fsyncSync(fd);
            fs.closeSync(fd);
            closed = true;
            fs.renameSync(temporary, filename);
            syncDirectory(directory);
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            let cleanupError: unknown;
            if (!closed)
              try {
                fs.closeSync(fd);
              } catch (error) {
                cleanupError = error;
              }
            try {
              fs.rmSync(temporary, { force: true });
            } catch (error) {
              cleanupError ??= error;
            }
            if (!failed && cleanupError) throw cleanupError;
          }
        },
      });
    } finally {
      release();
    }
  }
}
