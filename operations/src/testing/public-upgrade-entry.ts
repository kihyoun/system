import 'reflect-metadata';
import fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { PublicUpgradeFixtureModule } from './public-upgrade.module';
import { PublicUpgradeTransportService } from './public-upgrade-transport.service';
import { PublicUpgradeRuntimeService } from './public-upgrade-runtime.service';
export async function main(action: string, program: string, args: string[]) {
  const app = await NestFactory.createApplicationContext(PublicUpgradeFixtureModule, {
    logger: false,
  });
  try {
    if (action === 'prepare') app.get(PublicUpgradeRuntimeService).prepare(program);
    else if (action === 'verify-host') app.get(PublicUpgradeRuntimeService).verifyHost();
    else if (action === 'write')
      app.get(PublicUpgradeRuntimeService).write(program, fs.readFileSync(0));
    else {
      const service = app.get(PublicUpgradeTransportService);
      const result =
        action === 'docker'
          ? await service.docker(program, args)
          : action === 'findmnt'
            ? await service.findmnt(args)
            : undefined;
      if (!result) throw Error('invalid-fixture-action');
      process.exitCode = result.status;
      if (result.signal) {
        await app.close();
        process.kill(process.pid, result.signal);
      }
    }
  } finally {
    await app.close();
  }
}
if (require.main === module)
  void main(process.argv[2], process.argv[3], process.argv.slice(4)).catch(() => {
    console.error('public-upgrade-fixture-failed');
    process.exitCode = 1;
  });
