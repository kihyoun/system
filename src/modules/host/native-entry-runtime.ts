import type { DynamicModule, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NativePortChannel } from './native-port-channel';
/** Private worker mode reuses providers, never a request's native callback results. */
export class NativeEntryRuntime {
  readonly channel = new NativePortChannel();
  private app?: INestApplicationContext;
  readonly worker = process.argv.includes('--worker');
  async application(module: DynamicModule): Promise<INestApplicationContext> {
    return (this.app ??= await NestFactory.createApplicationContext(module, { logger: false }));
  }

  async settled(): Promise<void> {
    if (!this.worker || process.exitCode) await this.close();
  }

  private async close(): Promise<void> {
    await this.app?.close();
    this.app = undefined;
  }

  async run(main: () => Promise<void>): Promise<void> {
    try {
      do {
        await main();
      } while (this.worker && !process.exitCode);
    } finally {
      await this.close();
    }
  }
}
