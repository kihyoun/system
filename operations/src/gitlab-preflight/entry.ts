import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { nativeProcess } from '../runtime/process';
import { GitlabPreflightModule } from './gitlab-preflight.module';
import { GitlabPreflightService } from './gitlab-preflight.service';
export async function main(args = process.argv.slice(2)): Promise<void> {
  if (args.length !== 1 || !/^[a-f0-9]{64}$/.test(args[0]))
    throw Error('usage: gitlab-preflight EXACT_CONTAINER_ID');
  const app = await NestFactory.createApplicationContext(GitlabPreflightModule, { logger: false });
  try {
    const proof = await app.get(GitlabPreflightService).probe(args[0], {
      command: (command, timeout) =>
        nativeProcess.run('docker', ['--host=unix:///var/run/docker.sock', ...command], {
          timeout: timeout * 1000,
          maxBuffer: 1024 * 1024,
        }).stdout,
    });
    process.stdout.write(JSON.stringify(proof) + '\n');
  } finally {
    await app.close();
  }
}
if (require.main === module)
  main().catch(() => {
    process.stderr.write('gitlab-preflight-failed\n');
    process.exitCode = 1;
  });
