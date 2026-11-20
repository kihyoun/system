import { UPGRADE_PROCESS, type UpgradeProcess } from './native-process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Injectable, Inject } from '@nestjs/common';
import type { UpgradeSession } from './session';
import { GITLAB, childJournal, parseOwner, parseChild, type CommandOptions } from './types';
import { atomic, json } from './policy';

@Injectable()
export class UpgradeGuardianService {
  constructor(@Inject(UPGRADE_PROCESS) private readonly process: UpgradeProcess) {}
  ownedRun(
    session: UpgradeSession,
    binary: string,
    args: string[],
    opts: CommandOptions = {},
  ): string {
    if (!session.owner) return this.process.run(binary, args, opts);
    const timeout = opts.timeout || 180000;
    return this.process.run(
      process.execPath,
      [
        path.join(GITLAB, 'upgrade-child.js'),
        'watchdog',
        path.join(session.state, '.gitlab-upgrade-lock'),
      ],
      {
        timeout: timeout + 5000,
        detached: true,
        input: JSON.stringify({
          binary,
          args,
          timeout,
          cwd: opts.cwd,
          env: opts.env,
          input: opts.input,
        }),
      },
    );
  }
  lock(session: UpgradeSession, planSha256?: string): void {
    session.operation = crypto.randomBytes(16).toString('hex');
    session.held = [];
    const stat = fs.readFileSync('/proc/self/stat', 'utf8').split(' ').at(21);
    session.owner = {
      format: 'system-gitlab-upgrade-lock-v1',
      operation: session.operation,
      pid: process.pid,
      start: stat,
      planSha256,
    };
    const locks = [
      path.join(session.state, '.gitlab-upgrade-lock'),
      path.join(session.state, '.storage-operation-lock'),
      path.join(session.certbot, '.system-bootstrapper-certificate-lock'),
      path.join(session.state, '.projects.env/.wizard.env.environments.lock'),
    ];
    try {
      for (const lock of locks) {
        fs.mkdirSync(lock, { mode: 0o700 });
        session.held.push(lock);
        atomic(path.join(lock, 'upgrade-owner.json'), JSON.stringify(session.owner));
      }
    } catch (error) {
      session.unlock();
      throw error;
    }
  }
  updateOwner(session: UpgradeSession, checkpointSha256?: string): void {
    session.owner.checkpointSha256 = checkpointSha256;
    for (const lock of session.held)
      atomic(path.join(lock, 'upgrade-owner.json'), JSON.stringify(session.owner));
  }
  unlock(session: UpgradeSession): void {
    const childFile = path.join(session.state, '.gitlab-upgrade-lock/child.json');
    if (fs.existsSync(childFile)) {
      const child = parseChild(json(childFile));
      if (child.operation !== session.operation || childJournal.activeGroup(child.group))
        throw Error('upgrade-operation-child-still-running');
      fs.unlinkSync(childFile);
    }
    for (const lock of [...(session.held || [])].reverse()) {
      const name = path.join(lock, 'upgrade-owner.json');
      if (fs.existsSync(name)) {
        const owner = json(name);
        if (owner.operation !== session.operation) throw Error('upgrade-lock-ownership-mismatch');
        fs.unlinkSync(name);
      }
      fs.rmdirSync(lock);
    }
    session.held = [];
  }
  adopt(session: UpgradeSession, expected: string, field: 'planSha256' | 'checkpointSha256'): void {
    const root = path.join(session.state, '.gitlab-upgrade-lock');
    if (!fs.existsSync(root)) {
      session.lock(field === 'planSha256' ? expected : undefined);
      if (field === 'checkpointSha256') session.updateOwner(expected);
      return;
    }
    const owner = parseOwner(json(path.join(root, 'upgrade-owner.json')));
    if (
      owner.format !== 'system-gitlab-upgrade-lock-v1' ||
      owner[field] !== expected ||
      !Number.isInteger(owner.pid) ||
      !/^[a-f0-9]{32}$/.test(owner.operation || '')
    )
      throw Error('upgrade-interrupted-operation-requires-inspection');
    try {
      const actual = fs
        .readFileSync('/proc/' + owner.pid + '/stat', 'utf8')
        .split(' ')
        .at(21);
      if (actual === owner.start) throw Error('upgrade-operation-still-running');
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const childFile = path.join(root, 'child.json');
    if (fs.existsSync(childFile)) {
      const child = parseChild(json(childFile));
      if (
        child.format !== 'system-gitlab-upgrade-child-v1' ||
        child.operation !== owner.operation ||
        !Number.isInteger(child.group) ||
        child.group < 1 ||
        childJournal.activeGroup(child.group)
      )
        throw Error('upgrade-operation-child-still-running');
      const watcher = childJournal.stat(child.watchdogPid);
      if (watcher && watcher.state !== 'Z' && watcher.start === child.watchdogStart)
        throw Error('upgrade-operation-child-still-running');
    }
    session.operation = owner.operation;
    session.owner = owner;
    session.held = [
      root,
      path.join(session.state, '.storage-operation-lock'),
      path.join(session.certbot, '.system-bootstrapper-certificate-lock'),
      path.join(session.state, '.projects.env/.wizard.env.environments.lock'),
    ];
    for (const lock of session.held)
      if (json(path.join(lock, 'upgrade-owner.json')).operation !== session.operation)
        throw Error('upgrade-lock-ownership-mismatch');
    session.owner.pid = process.pid;
    session.owner.start = fs.readFileSync('/proc/self/stat', 'utf8').split(' ').at(21);
    for (const lock of session.held)
      atomic(path.join(lock, 'upgrade-owner.json'), JSON.stringify(session.owner));
  }
  async quiesceFinished(session: UpgradeSession): Promise<void> {
    if (session.owner?.quiesceDeadline) {
      const remaining = session.owner.quiesceDeadline - childJournal.uptime();
      if (remaining > 0) await session.sleep((remaining + 2) * 1000);
    }
  }
}
