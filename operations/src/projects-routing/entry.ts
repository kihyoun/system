import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import * as wizard from './wizard-aliases';
import * as application from './application-aliases';
import { impact } from './impact';
import { preserve } from './managed-project';
import { validateArchive } from './archive';
import type { RoutingCommand } from './projects-routing.service';
import { ProcessFailure } from '../runtime/process';
export async function main(tool: string, args: string[]): Promise<void> {
  const [action, ...values] = args;
  if (tool === 'wizard-aliases') {
    if (action === 'render')
      process.stdout.write(
        values[2] === 'recovery' ? '' : wizard.render(wizard.validateFiles(values[0], values[1])),
      );
    else if (action === 'validate') wizard.validateFiles(values[0], values[1]);
    else if (action === 'validate-import') wizard.validateImport(values[0], values[1]);
    else if (action === 'configure') wizard.configureFile(values);
    else throw Error('Use render, validate, validate-import or configure.');
  } else if (tool === 'application-aliases') {
    if (action === 'validate-import') {
      const selected = application.imported(values[0], values[1]);
      application.validate(
        selected.main,
        selected.projects.map((file) => file.content),
        fs.existsSync(path.join(values[1], '.docker.env')),
      );
    } else if (action === 'render')
      process.stdout.write(
        values[2] === 'recovery'
          ? ''
          : application.render(
              application.validate(
                fs.readFileSync(values[0], 'utf8'),
                wizard.projectFiles(values[1]).map((file) => file.content),
                true,
              ),
            ),
      );
    else throw Error('Use render or validate-import.');
  } else if (tool === 'impact') {
    const result = impact(action, values[0]);
    process.stdout.write(values[1] === 'mode' ? result.mode : JSON.stringify(result));
  } else if (tool === 'archive') validateArchive(action);
  else if (tool === 'managed-project') preserve(action, values[0], values[1]);
  else if (tool === 'routing') {
    const [root, templates, ...projects] = values;
    if (!root || !path.isAbsolute(root)) throw Error('Absolute routing checkout required.');
    const { NestFactory } = await import('@nestjs/core');
    const { ProjectsRoutingModule } = await import('./projects-routing.module.js');
    const { ProjectsRoutingService } = await import('./projects-routing.service.js');
    const app = await NestFactory.createApplicationContext(ProjectsRoutingModule, {
      logger: false,
    });
    try {
      app.get(ProjectsRoutingService).run({
        action: action as RoutingCommand['action'],
        root,
        templates: templates || undefined,
        projects,
      });
    } finally {
      await app.close();
    }
  } else throw Error('Unknown routing tool.');
}
export function runCli(tool: string, args: string[] = process.argv.slice(2)): void {
  main(tool, args).catch((error: unknown) => {
    const prefix =
      tool === 'wizard-aliases'
        ? 'Wizard aliases: '
        : tool === 'application-aliases'
          ? 'Application aliases: '
          : tool === 'impact'
            ? 'Configuration impact: '
            : 'Routing: ';
    console.error(prefix + (error instanceof Error ? error.message : 'operation failed'));
    process.exitCode = error instanceof ProcessFailure && error.status ? error.status : 1;
  });
}
if (require.main === module) runCli(process.argv[2], process.argv.slice(3));
