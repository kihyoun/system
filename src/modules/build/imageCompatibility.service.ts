import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
/** Installs the public image command and aliases consumed by retained managed recipes. */
@Injectable()
export class ImageCompatibilityService {
  install(root: string): void {
    if (!['/system', '/candidate'].includes(root)) {
      throw Error('container-image-root-required');
    }

    const aliases: [string, string][] = [
      [
        'project-bootstrap/wizard-environments/helper.js',
        'dist/compatibility/environmentHelper.js',
      ],
      ...['typed-v6', 'quickstart-v5', 'modern/smoke'].map(
        (name) =>
          [
            'project-bootstrap/wizard-build/' + name,
            'templates/project-bootstrap/wizard-build/' + name,
          ] as [string, string],
      ),
    ];
    for (const [relative, target] of aliases) {
      const filename = path.join(root, relative),
        destination = path.join(root, target);

      if (!fs.existsSync(destination)) {
        throw Error('retained-recipe-compatibility-target-required');
      }

      fs.mkdirSync(path.dirname(filename), { recursive: true });
      const existing = fs.lstatSync(filename, { throwIfNoEntry: false });

      if (existing) {
        if (
          !existing.isSymbolicLink() ||
          fs.realpathSync(filename) !== fs.realpathSync(destination)
        ) {
          throw Error('retained-recipe-compatibility-path-conflict');
        }
      } else {
        fs.symlinkSync(
          path.relative(path.dirname(filename), destination),
          filename,
          fs.statSync(destination).isDirectory() ? 'dir' : 'file',
        );
      }
    }

    if (root === '/system') {
      this.installCommand();
    }
  }

  private installCommand(): void {
    const target = '/system/dist/cli/main.js',
      command = '/usr/local/bin/system-bootstrapper';
    const entry = fs.lstatSync(target);

    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !fs.readFileSync(target, 'utf8').startsWith('#!/usr/bin/env node\n')
    ) {
      throw Error('compiled-image-command-required');
    }

    const existing = fs.lstatSync(command, { throwIfNoEntry: false });

    if (existing && (!existing.isSymbolicLink() || fs.realpathSync(command) !== target)) {
      throw Error('image-command-path-conflict');
    }

    fs.chmodSync(target, 0o755);

    if (!existing) {
      fs.symlinkSync(target, command);
    }
  }
}
