import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ProjectLifecycleModule } from './project-lifecycle.module';
import { SourceTransferService, SourceTransferInput } from './source-transfer.service';
async function invoke<T>(operation: (service: SourceTransferService) => Promise<T>): Promise<T> {
  const app = await NestFactory.createApplicationContext(ProjectLifecycleModule, { logger: false });
  try {
    return await operation(app.get(SourceTransferService));
  } finally {
    await app.close();
  }
}
export function sourceTransfer(input: SourceTransferInput) {
  return invoke((service) => service.transfer(input));
}
export function sourcePreflight(origin: string) {
  return invoke((service) => service.preflight(origin));
}
