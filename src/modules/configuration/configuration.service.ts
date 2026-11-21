import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProcessFailure, type ProcessRunner } from '../../common/runtime/process';
import { startupBegin, startupSettled } from '../storage/lease';
import { validateArchive } from '../projects-routing/archive';
import { preserve } from '../projects-routing/managed-project';
import { impact } from '../projects-routing/impact';
import * as wizard from '../projects-routing/wizard-aliases';
import * as application from '../projects-routing/application-aliases';
import { ProjectsRoutingService } from '../projects-routing/projects-routing.service';
export const CONFIGURATION_PROCESS = Symbol('CONFIGURATION_PROCESS');
export interface PushCommand {
  root: string;
  state: string;
  archive: string;
  fingerprint?: string;
  templates?: string;
  parentStorage?: unknown;
}
@Injectable()
export class ConfigurationService {
  constructor(
    @Inject(CONFIGURATION_PROCESS) private readonly process: ProcessRunner,
    private readonly routing: ProjectsRoutingService,
  ) {}

  deleteProjects(root: string, state: string): void {
    if (!path.isAbsolute(state)) throw Error('Absolute configuration path required.');
    if (!path.isAbsolute(root)) throw Error('Absolute checkout path required.');
    this.process.run(
      process.execPath,
      [path.join(root, 'dist/cli/main.js'), 'lifecycle', 'stop-intermediate', root],
      {
        cwd: root,
        env: { ...process.env, SYSTEM_CONFIG_DIR: state },
        timeout: 180000,
        maxBuffer: 1024 * 1024,
      },
    );
    const operation = startupBegin(state, process.pid);
    let settled: number | null = 1;
    try {
      const remove = (directory: string) => {
        const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
        if (!stat) return;
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw Error('Unsafe project configuration directory.');
        for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
          const filename = path.join(directory, item.name);
          if (item.isDirectory()) remove(filename);
          else if (item.isFile() && item.name.endsWith('.env')) fs.unlinkSync(filename);
        }
      };
      remove(path.join(state, '.projects.env'));
      remove(path.join(state, 'projects.env'));
      settled = 0;
    } finally {
      startupSettled(state, operation, settled);
    }
  }

  push(command: PushCommand): string {
    for (const file of [command.root, command.state, command.archive])
      if (!path.isAbsolute(file)) throw Error('Absolute configuration paths required.');
    // Reuse the durable startup/storage barrier; killed or uncertain children retain it.
    const inherited = this.parentLease(command);
    const operation = inherited ? undefined : startupBegin(command.state, process.pid);
    const barrier = path.join(command.state, '.projects.env/.wizard.env.environments.lock');
    let held = false,
      settled: number | null = 1;
    try {
      fs.mkdirSync(path.dirname(barrier), { recursive: true });
      if (!inherited) {
        fs.mkdirSync(barrier, { mode: 0o700 });
        held = true;
      }
      const result = this.importArchive(command);
      settled = 0;
      return result;
    } catch (error) {
      if (error instanceof ProcessFailure && error.uncertain) settled = null;
      if (error instanceof AggregateError) settled = null;
      throw error;
    } finally {
      if (settled !== null && held) fs.rmdirSync(barrier);
      if (operation) startupSettled(command.state, operation, settled);
    }
  }

  private parentLease(command: PushCommand): boolean {
    if (command.parentStorage === undefined) return false;
    const parent = command.parentStorage;
    const directory = path.join(command.state, '.storage-operation-lock');
    const owner = path.join(directory, 'operation.json');
    const barrier = path.join(command.state, '.projects.env/.wizard.env.environments.lock');
    const invalid = () => {
      throw Error('Configuration parent storage ownership differs.');
    };
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return invalid();
    for (const file of [directory, barrier])
      if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isDirectory()) return invalid();
    if (
      !fs.lstatSync(owner, { throwIfNoEntry: false })?.isFile() ||
      fs.existsSync(path.join(command.state, '.gitlab-upgrade-lock'))
    )
      return invalid();
    const current: unknown = JSON.parse(fs.readFileSync(owner, 'utf8'));
    if (!current || typeof current !== 'object' || Array.isArray(current)) return invalid();
    const requested = parent as Record<string, unknown>,
      actual = current as Record<string, unknown>;
    if (
      actual.format !== 'system-storage-operation-v1' ||
      actual.completion !== 'running' ||
      actual.operation !== 'restore' ||
      requested.operation !== 'restore' ||
      typeof requested.helperName !== 'string' ||
      !requested.helperName ||
      typeof requested.imageId !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(requested.imageId) ||
      requested.helperName !== actual.helperName ||
      requested.imageId !== actual.imageId
    )
      return invalid();
    return true;
  }

  private importArchive(command: PushCommand): string {
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrapper-push-'));
    const snapshot = path.join(staging, '.system-wizard-receipt');
    const project = path.join(command.state, '.projects.env/.wizard.env');
    const source = path.join(staging, 'archive');
    const previous = path.join(staging, 'previous');
    let rollback = false;
    const run = (binary: string, args: string[]) =>
      this.process.run(binary, args, { timeout: 120000, maxBuffer: 1024 * 1024 });
    const projectsCopy = (from: string, to: string, remove = false) =>
      run('rsync', [
        '-a',
        ...(remove ? ['--delete'] : []),
        '--exclude=/.wizard.env.environments.lock/',
        from + '/',
        to + '/',
      ]);
    try {
      validateArchive(command.archive, this.process);
      run('unzip', ['-q', command.archive, '-d', source]);
      const configs = fs
        .readdirSync(source)
        .filter((name) => name.endsWith('.env') && name !== '.projects.env');
      for (const name of configs)
        if (!fs.lstatSync(path.join(source, name)).isFile())
          throw Error('Configuration entry is not a regular file.');
      if (!configs.length && !fs.existsSync(path.join(source, '.projects.env')))
        throw Error('No configuration found in archive.');
      const check = (directory: string) => {
        for (const name of fs.readdirSync(directory)) {
          const file = path.join(directory, name),
            stat = fs.lstatSync(file);
          if (stat.isSymbolicLink()) throw Error('Configuration archive contains a symbolic link.');
          if (stat.isDirectory()) check(file);
        }
      };
      check(source);
      wizard.validateImport(source, command.state);
      const selected = application.imported(source, command.state);
      application.validate(
        selected.main,
        selected.projects.map((file) => file.content),
        fs.existsSync(path.join(command.state, '.docker.env')),
      );
      const result = impact(source, command.state);
      if (command.fingerprint && result.fingerprint !== command.fingerprint)
        throw Error('Configuration changed since impact review.');
      if (result.mode === 'routing') {
        fs.mkdirSync(path.join(previous, '.projects.env'), { recursive: true });
        run('cp', [
          '-p',
          '--',
          path.join(command.state, '.docker.env'),
          path.join(previous, '.docker.env'),
        ]);
        projectsCopy(
          path.join(command.state, '.projects.env'),
          path.join(previous, '.projects.env'),
        );
        rollback = true;
      }
      if (fs.existsSync(path.join(source, '.projects.env'))) {
        preserve('snapshot', project, snapshot);
        projectsCopy(
          path.join(source, '.projects.env'),
          path.join(command.state, '.projects.env'),
          true,
        );
        preserve('restore', project, snapshot);
      }
      for (const name of configs) {
        const next = fs.mkdtempSync(path.join(command.state, '.push-config-'));
        try {
          const file = path.join(next, 'record');
          run('cp', ['--', path.join(source, name), file]);
          fs.chmodSync(file, 0o600);
          fs.renameSync(file, path.join(command.state, name));
        } finally {
          fs.rmSync(next, { recursive: true, force: true });
        }
      }
      if (result.mode === 'routing') {
        this.routing.run({
          action: 'apply',
          root: command.root,
          templates: command.templates,
          projects: result.projects,
        });
        rollback = false;
      }
      return result.mode;
    } catch (error) {
      if (rollback) {
        try {
          projectsCopy(
            path.join(previous, '.projects.env'),
            path.join(command.state, '.projects.env'),
            true,
          );
          run('cp', [
            '-p',
            '--',
            path.join(previous, '.docker.env'),
            path.join(command.state, '.docker.env'),
          ]);
        } catch (restore) {
          throw new AggregateError(
            [error, restore],
            'Configuration rollback failed; operation barrier retained.',
          );
        }
      }
      throw error;
    } finally {
      try {
        preserve('restore', project, snapshot);
        fs.rmSync(staging, { recursive: true, force: true });
      } catch (cleanup) {
        throw new AggregateError(
          [cleanup],
          'Configuration cleanup failed; retained receipt and operation barrier require inspection.',
        );
      }
    }
  }
}
