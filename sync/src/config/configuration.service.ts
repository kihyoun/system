import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import md5 from 'md5';
import type { UploadedFile, FileArray } from 'express-fileupload';
import { mainConfigPath, projectsDirectory, projectConfigPath } from '../StatePaths';
import { configurationImpact } from '../ConfigurationImpact';
import { recoveryObservation } from '../RecoveryObservation';
import { suggestConfig } from '../ConfigSuggestions';
import { validProjectKey, validateAliasProject, readReceipt } from '../ProjectBootstrap';
import { RuntimeService } from '../runtime/runtime.service';
import { SyncHttpError, operationFailed } from '../http/sync-http-error';
const wizardAliases = require('../../../nginx/wizard-aliases');
const applicationAliases = require('../../../nginx/application-aliases');

@Injectable()
export class ConfigurationService {
  constructor(private readonly runtime: RuntimeService) {}
  main() {
    if (!fs.existsSync(mainConfigPath())) throw new SyncHttpError(404);
    const data = fs.readFileSync(mainConfigPath(), { encoding: 'utf8', flag: 'r' });
    return { filename: '.docker.env', data, recoveryObservation: recoveryObservation() };
  }
  suggestions(hostname: string) {
    if (fs.existsSync(mainConfigPath()))
      throw new SyncHttpError(409, { message: 'Saved configuration exists. Fetch it instead.' });
    try {
      const files = ['/templates/default.conf.template', '/synctemplates/default.conf.template'];
      const nginx = files
        .filter((file) => fs.existsSync(file))
        .map((file) => fs.readFileSync(file, 'utf8'))
        .join('\n');
      return suggestConfig(nginx, hostname, os.hostname(), process.env.SEED_DIR || '');
    } catch {
      throw new SyncHttpError(500, { message: 'Could not derive configuration suggestions.' });
    }
  }
  projects() {
    try {
      const dir = projectsDirectory();
      const fileNames = fs
        .readdirSync(dir)
        .sort((a, b) => (a === '.wizard.env' ? -1 : b === '.wizard.env' ? 1 : a.localeCompare(b)));
      return fileNames
        .filter((file) => file !== '.projects.env' && file.substr(-3, 3) === 'env')
        .map((filename) => {
          const data = fs.readFileSync(path.join(dir, filename), { encoding: 'utf8', flag: 'r' });
          const receipt = readReceipt(data);
          return {
            filename,
            data,
            repository: receipt?.repository,
            namespaceId: receipt?.namespaceId,
            template: receipt?.template,
            bootstrapPending: !!receipt && receipt.state !== 'complete',
          };
        });
    } catch {
      throw operationFailed();
    }
  }
  private upload(files: FileArray | undefined, field: string): UploadedFile {
    const file = files?.[field];
    if (!file || Array.isArray(file) || file.name !== field) throw new SyncHttpError(400);
    return file;
  }
  impact(files: FileArray | undefined) {
    const file = this.upload(files, 'bootstrapper.zip');
    try {
      return configurationImpact(file.data);
    } catch (error) {
      throw new SyncHttpError(400, { message: error.message });
    }
  }
  pushZip(files: FileArray | undefined, input: any) {
    const file = this.upload(files, 'bootstrapper.zip');
    try {
      if (input?.impact && input.impact !== configurationImpact(file.data).fingerprint)
        throw new SyncHttpError(409, {
          message: 'Configuration changed since impact review. Review Push again.',
        });
      fs.writeFileSync('../bootstrapper.zip', file.data);
      const out = execSync('cd ../system; bash push.sh', {
        env: {
          ...process.env,
          SYSTEM_PUSH_IMPACT: typeof input?.impact === 'string' ? input.impact : '',
        },
      });
      const mode = /^APPLY_MODE=(none|routing|restart)$/m.exec(out.toString())?.[1] || 'restart';
      this.runtime.status.needRestart = mode === 'restart';
      return {
        message: this.runtime.status.needRestart
          ? 'Config written. Restarting system.'
          : mode === 'routing'
            ? 'Application routing applied. GitLab remains available.'
            : 'Config written. No service restart required.',
        applyMode: mode,
        status: this.runtime.status,
        output: out.toString(),
      };
    } catch (error) {
      if (error instanceof SyncHttpError) throw error;
      throw operationFailed();
    }
  }
  writeProject(input: any) {
    try {
      if (
        input.data.substr(807, 1) !== '$' ||
        md5(input.data.substr(0, 1184)) !== 'bd4a8426355824593a5e21ad759830c1' ||
        !validProjectKey(input.projectKey)
      )
        throw new SyncHttpError(400);
      try {
        validateAliasProject(input.data, input.projectKey);
      } catch (error) {
        throw new SyncHttpError(400, { message: error.message });
      }
      console.log('Stopping intermediate Services...');
      const out = execSync('cd ../system; bash stop-intermediate.sh');
      fs.writeFileSync(projectConfigPath(input.projectKey), input.data);
      this.runtime.status.needRestart = true;
      return { message: 'New Project added.', status: this.runtime.status, output: out.toString() };
    } catch (error) {
      if (error instanceof SyncHttpError) throw error;
      throw operationFailed();
    }
  }
  writeMain(files: FileArray | undefined) {
    const file = this.upload(files, '.docker.env');
    try {
      try {
        const contents = wizardAliases
          .projectFiles(projectsDirectory())
          .map((project: { content: string }) => project.content);
        wizardAliases.validate(file.data.toString('utf8'), contents);
        applicationAliases.validate(
          file.data.toString('utf8'),
          contents,
          fs.existsSync(mainConfigPath()),
        );
      } catch (error) {
        throw new SyncHttpError(400, { message: error.message });
      }
      console.log('Stopping intermediate services...');
      const out = execSync('cd ../system; bash stop-intermediate.sh');
      fs.writeFileSync(mainConfigPath(), file.data);
      this.runtime.status.needRestart = true;
      return {
        message: 'Main config written.',
        status: this.runtime.status,
        output: out.toString(),
      };
    } catch (error) {
      if (error instanceof SyncHttpError) throw error;
      throw operationFailed();
    }
  }
  deleteProjects() {
    try {
      console.log('Stopping intermediate services...');
      const out = execSync('cd ../system; bash stop-intermediate.sh');
      console.log('Deleting project configurations...');
      const out2 = execSync('cd ../system; bash delete-projects.sh');
      this.runtime.status.needRestart = true;
      return {
        message: 'Deleting project configuration done.',
        status: this.runtime.status,
        output: out.toString() + out2.toString(),
      };
    } catch {
      throw operationFailed();
    }
  }
  deleteMain() {
    if (!fs.existsSync(mainConfigPath()))
      throw new SyncHttpError(404, 'File does not exist.', true);
    try {
      console.log('Stopping intermediate services...');
      const out = execSync('cd ../system; bash stop-intermediate.sh');
      console.log('Unlink ../systen/.docker.env');
      fs.unlinkSync(mainConfigPath());
      this.runtime.status.needRestart = true;
      return {
        message: 'Main config deleted.',
        status: this.runtime.status,
        output: out.toString(),
      };
    } catch {
      throw operationFailed();
    }
  }
}
