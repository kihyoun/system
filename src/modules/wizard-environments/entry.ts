import 'reflect-metadata';
import fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { WizardEnvironmentsModule } from './wizardEnvironments.module';
import { WizardEnvironmentWorkflowService } from './wizardEnvironmentWorkflow.service';
import { EnvironmentPreflightService } from './environmentPreflight.service';

function readInput(file: string): unknown {
  const stat = fs.lstatSync(file);

  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 20000 || (stat.mode & 0o077) !== 0) {
    throw Error('Use a private regular settings JSON file.');
  }

  const input: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  return input;
}

export async function wizardEnvironmentsMain(args: string[]): Promise<unknown> {
  const command = args[0];

  if (
    !['preview', 'inspect', 'status', 'configure', 'preflight'].includes(command) ||
    args.length !== (command === 'configure' || command === 'preflight' ? 2 : 1)
  ) {
    throw Error(
      'Use preview, inspect, status, configure REQUEST_FILE, or preflight SETTINGS_FILE.',
    );
  }

  const input = args.length === 2 ? readInput(args[1]) : undefined;
  const app = await NestFactory.createApplicationContext(WizardEnvironmentsModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const workflow = app.get(WizardEnvironmentWorkflowService);

    if (command === 'preview') {
      return workflow.preview();
    }

    if (command === 'inspect') {
      return workflow.inspect();
    }

    if (command === 'preflight') {
      return await app.get(EnvironmentPreflightService).validateSettings(input);
    }

    const result = command === 'configure' ? workflow.configure(input) : workflow.refresh();
    while (result.state === 'running') {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (result.state === 'failed') {
      throw Error(result.message);
    }

    return result;
  } finally {
    await app.close();
  }
}
