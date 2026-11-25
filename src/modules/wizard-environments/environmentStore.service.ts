import { Inject, Injectable } from '@nestjs/common';
import path from 'node:path';
import { validConfigurationSignature } from '../../common/configurationValidation';
import * as wizardAliases from '../projects-routing/wizardAliases';
import {
  environmentFiles,
  environmentInputs,
  environmentProject,
  EnvironmentFilePort,
  EnvironmentInputs,
  EnvironmentProjectPort,
} from './ports';
import { readEnvironmentReceipt } from './receipt';
import { hasDeployments, normalizeSettings, validateHostAssignments } from './settings';
import type {
  EnvironmentContext,
  EnvironmentReceipt,
  EnvironmentReservation,
  EnvironmentSettings,
  PlatformSettings,
} from './types';

export interface EnvironmentWriteSession {
  context: EnvironmentContext;
  updating: boolean;
  expectedContent: string;
  receipt: EnvironmentReceipt;
  reservation: EnvironmentReservation;
}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

@Injectable()
export class EnvironmentStoreService {
  constructor(
    @Inject(environmentProject) private readonly project: EnvironmentProjectPort,
    @Inject(environmentFiles) private readonly files: EnvironmentFilePort,
    @Inject(environmentInputs) readonly inputs: EnvironmentInputs,
  ) {}

  private configuration(file: string): string {
    if (!this.files.regular(file)) {
      throw new Error('Wizard configuration signature changed.');
    }

    const value = this.files.read(file);

    if (!validConfigurationSignature(value)) {
      throw new Error('Wizard configuration signature changed.');
    }

    return value;
  }

  read() {
    const content = this.configuration(this.inputs.wizardFile());
    const mainContent = this.configuration(this.inputs.mainFile());
    return {
      content,
      mainContent,
      receipt: readEnvironmentReceipt(this.project.readReceipt(content)),
      platform: this.project.readSettings(mainContent),
    };
  }

  settings(input: unknown, platform: PlatformSettings): EnvironmentSettings {
    const selected = normalizeSettings(input, platform);
    const main = this.configuration(this.inputs.mainFile());
    const aliases = wizardAliases.validate(main).aliases;
    const directory = path.dirname(this.inputs.wizardFile());
    const projects = this.files.exists(directory)
      ? this.files
          .entries(directory)
          .filter((filename) => filename !== '.wizard.env' && filename.endsWith('.env'))
          .map((filename) =>
            this.project.readSettings(this.files.read(path.join(directory, filename))),
          )
      : [];
    validateHostAssignments(selected, aliases, projects);
    return selected;
  }

  platform(): PlatformSettings {
    return this.project.readSettings(this.configuration(this.inputs.mainFile()));
  }

  locked(): boolean {
    return this.files.exists(this.inputs.wizardFile() + '.environments.lock');
  }

  session(
    context: EnvironmentContext,
    reservation: EnvironmentReservation,
    updating: boolean,
  ): EnvironmentWriteSession {
    return {
      context,
      reservation,
      updating,
      expectedContent: context.content,
      receipt: context.receipt,
    };
  }

  private withoutDeployments(content: string) {
    const receipt = readEnvironmentReceipt(this.project.readReceipt(content));

    if (receipt.wizardWorkflow.environments) {
      delete receipt.wizardWorkflow.environments.deployments;
    }

    const data = content
      .split('\n')
      .filter((line) => !line.startsWith('# BOOTSTRAPPER_PROJECT='))
      .join('\n');
    return { data, receipt };
  }

  persist(
    session: EnvironmentWriteSession,
    requested: EnvironmentReservation,
    settingsData?: string,
  ): void {
    const lock = this.inputs.wizardFile() + '.environments.lock';
    try {
      this.files.lock(lock);
    } catch {
      throw new Error(
        'An environment helper owns the configuration lock. Wait for it to finish and refresh status.',
      );
    }
    try {
      const actual = this.configuration(this.inputs.wizardFile());

      if (
        this.configuration(this.inputs.mainFile()) !== session.context.mainContent ||
        (actual !== session.expectedContent &&
          !same(this.withoutDeployments(actual), this.withoutDeployments(session.expectedContent)))
      ) {
        throw new Error(
          'Wizard configuration or receipt changed during the environment operation. Fetch and inspect before retrying.',
        );
      }

      const live = readEnvironmentReceipt(this.project.readReceipt(actual)).wizardWorkflow
        .environments;

      if (session.updating && live?.operation !== requested.operation && hasDeployments(live)) {
        throw new Error(
          'A deployment started before settings were reserved. Stop it and fetch a fresh preview.',
        );
      }

      const next =
        live?.operation === requested.operation && live.deployments !== undefined
          ? { ...requested, deployments: live.deployments }
          : requested;
      const receipt = {
        ...session.receipt,
        wizardWorkflow: { ...session.receipt.wizardWorkflow, environments: next },
      };
      const data =
        settingsData === undefined
          ? actual
              .split('\n')
              .filter((line) => !line.startsWith('# BOOTSTRAPPER_PROJECT='))
              .join('\n')
          : settingsData;
      this.project.writeReceipt(this.inputs.wizardFile(), data, receipt);
      this.files.persisted(this.inputs.wizardFile());
      session.expectedContent = this.configuration(this.inputs.wizardFile());
      session.receipt = receipt;
      session.reservation = next;
    } finally {
      this.files.unlock(lock);
    }
  }
}
