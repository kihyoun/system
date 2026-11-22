import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import crypto from 'node:crypto';
import { checkoutPath } from '../../common/runtime/installationPaths';
import * as project from '../project-workflow/projectWorkflow';
import * as configuration from '../project-workflow/projectConfiguration';
import * as primary from '../project-lifecycle/sourcePrimaryEnvironment';
import * as legacy from '../project-lifecycle/buildRecipe.service';
import {
  generate as environmentRecipe,
  EnvironmentRecipeOptions,
} from '../project-lifecycle/environmentRecipe.service';
import { readEnvironmentReservation } from './receipt';
import { object } from './settings';
import {
  EnvironmentFilePort,
  EnvironmentInputs,
  EnvironmentNativeRequest,
  EnvironmentPreflightPort,
  EnvironmentProjectPort,
  EnvironmentRecipePort,
} from './ports';
import type {
  EnvironmentJob,
  EnvironmentOutcome,
  EnvironmentReceipt,
  EnvironmentReservation,
  EnvironmentSettings,
  PlatformSettings,
} from './types';

/** External-operation seam only; workflow state belongs to the injected services. */
export const environmentAdapters = {
  resolve: async (host: string): Promise<string[]> =>
    (await dns.lookup(host, { all: true })).map((row) => row.address),
  certificate: async (host: string, certificate: string, key: string): Promise<void> => {
    const certFile = fs.realpathSync(certificate),
      keyFile = fs.realpathSync(key);

    if (
      !certFile.startsWith('/ssl/') ||
      !keyFile.startsWith('/ssl/') ||
      !fs.statSync(keyFile).isFile()
    ) {
      throw new Error('Use certificate and key files from the platform SSL volume.');
    }

    const cert = new crypto.X509Certificate(fs.readFileSync(certFile));

    if (!cert.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(keyFile)))) {
      throw new Error('The environment certificate and private key do not match.');
    }

    if (
      cert.checkHost(host, { subject: 'never', wildcards: false }) !== host ||
      Date.parse(cert.validFrom) > Date.now() ||
      Date.parse(cert.validTo) <= Date.now()
    ) {
      throw new Error(
        'An enabled environment requires a valid certificate for its exact HTTPS host.',
      );
    }
  },
  recipe: (logo: string, input: EnvironmentRecipeOptions) => environmentRecipe(logo, input),
} satisfies EnvironmentPreflightPort & { recipe: typeof environmentRecipe };

export const nativeEnvironmentFiles: EnvironmentFilePort = {
  read: (file) => fs.readFileSync(file, 'utf8'),
  exists: (file) => fs.existsSync(file),
  entries: (directory) => fs.readdirSync(directory),
  regular: (file) => {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink();
  },
  lock: (directory) => {
    fs.mkdirSync(directory, { mode: 0o700 });
  },
  unlock: (directory) => {
    fs.rmdirSync(directory);
  },
  persisted: (file) => {
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    const parent = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(parent);
    } finally {
      fs.closeSync(parent);
    }
  },
};
const directory = () =>
  path.resolve(process.env.SYSTEM_CONFIG_DIR || checkoutPath('config/system'));
export const nativeEnvironmentInputs: EnvironmentInputs = {
  wizardFile: () => path.join(directory(), '.projects.env/.wizard.env'),
  mainFile: () => path.join(directory(), '.docker.env'),
  helperImage: () => process.env.SYSTEM_WIZARD_ENVIRONMENT_IMAGE || '',
  controller: () => process.env.SYSTEM_WIZARD_CANONICAL_CONTROLLER || 'system_bootstrapper_1',
};
function isEnvironmentJob(value: unknown): value is EnvironmentJob {
  if (!object(value) || typeof value.id !== 'string' || typeof value.state !== 'string') {
    return false;
  }

  if (value.message !== undefined && typeof value.message !== 'string') {
    return false;
  }

  if (value.created !== undefined && typeof value.created !== 'number') {
    return false;
  }

  try {
    if (value.environments !== undefined) {
      readEnvironmentReservation(value.environments);
    }
  } catch {
    return false;
  }
  return true;
}
function job(value: unknown): EnvironmentJob {
  if (!isEnvironmentJob(value)) {
    throw new Error(
      'The environment reservation changed. Inspect the server-owned receipt before continuing.',
    );
  }

  return value;
}

@Injectable()
export class NativeEnvironmentProjectAdapter implements EnvironmentProjectPort {
  readReceipt(content: string): unknown {
    return project.readReceipt(content);
  }

  writeReceipt(file: string, data: string, receipt: EnvironmentReceipt): void {
    project.writeReceipt(file, data, receipt);
  }

  validateProject(input: {
    projectKey: string;
    namespaceId: string | number;
    template: 'wizard';
    data: string;
    ci: string;
  }): unknown {
    return project.validateProject(input);
  }

  call(input: EnvironmentNativeRequest): Promise<unknown> {
    return project.rails({ ...input });
  }

  startJob(id: string, work: () => Promise<EnvironmentOutcome>): EnvironmentJob {
    return job(project.startJob(id, work));
  }

  lookupJob(id: string): EnvironmentJob | undefined {
    const value = project.lookupJob(id);
    return value === undefined ? undefined : job(value);
  }

  withProjectLock<T>(id: string, work: () => T, parentOperation?: string): T {
    return project.withProjectLock(id, work, parentOperation);
  }

  readSettings(content: string): PlatformSettings {
    return configuration.readSettings(content);
  }

  wizardCi(): string {
    return configuration.wizardCi();
  }

  wizardConfiguration(platform: PlatformSettings, settings: EnvironmentSettings): string {
    return configuration.wizardConfiguration(platform, settings);
  }
}

@Injectable()
export class NativeEnvironmentRecipeAdapter implements EnvironmentRecipePort {
  generate(logo: string, options: EnvironmentRecipeOptions) {
    return { ...environmentAdapters.recipe(logo, options) };
  }

  primary(reservation: EnvironmentReservation) {
    return primary.reservation(reservation);
  }

  nextPrimary(
    previous: EnvironmentReservation,
    options: { operation: string; helperImage: string; activationCommit: string; ciFiles: unknown },
  ): EnvironmentReservation {
    return readEnvironmentReservation(primary.sourcePrimaryEnvironment(previous, options));
  }

  select(logo: string, recipeHash: string) {
    return legacy.select(logo, recipeHash);
  }

  forSource(logo: string, revision: string) {
    return legacy.forSource(logo, revision);
  }
}
