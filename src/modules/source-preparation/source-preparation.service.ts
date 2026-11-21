import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { WizardSourceService } from './wizard-source.service';
import { ProcessRunner } from '../../common/runtime/process';
export const SOURCE_PROCESS = Symbol('SOURCE_PROCESS');
@Injectable()
export class SourcePreparationService {
  constructor(
    @Inject(SOURCE_PROCESS) private readonly process: ProcessRunner,
    private readonly source: WizardSourceService,
  ) {}

  prepare(root: string): void {
    if (!path.isAbsolute(root)) throw Error('Absolute source checkout required');
    const system = this.gitDirectory(root);
    const wizard = fs.existsSync(path.join(root, 'wizard/.git'))
      ? this.gitDirectory(path.join(root, 'wizard'))
      : system;
    const snapshot = this.source.pack(root, { system, wizard });
    const directory = path.join(root, 'assets/wizard-source');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'snapshot.json'), JSON.stringify(snapshot));
  }

  private gitDirectory(repository: string): string {
    let directory = path.join(repository, '.git');
    if (fs.statSync(directory).isFile()) {
      const pointer = fs.readFileSync(directory, 'utf8').split(/\r?\n/)[0];
      if (!pointer.startsWith('gitdir: ')) throw Error('Invalid linked checkout Git pointer');
      directory = pointer.slice(8);
      if (/^[A-Za-z]:\//.test(directory) && process.platform !== 'win32')
        directory = this.process
          .run('wslpath', ['-u', directory], { timeout: 30000 })
          .stdout.trim();
      else if (!path.isAbsolute(directory)) directory = path.resolve(repository, directory);
    }
    return fs.realpathSync(directory);
  }
}
