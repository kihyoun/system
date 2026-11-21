import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { EnvironmentModule } from './environment.module';
import { EnvironmentService } from './environment.service';
import { DeploymentRequest } from './types';
export async function environmentMain(request: DeploymentRequest, cleanup = false) {
  const app = await NestFactory.createApplicationContext(EnvironmentModule.register(request), {
    logger: false,
    abortOnError: false,
  });
  const service = app.get(EnvironmentService);
  const cancel = () => service.runtime.cancel();
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  try {
    return await (cleanup ? service.cleanupStopped() : service.run());
  } finally {
    process.removeListener('SIGTERM', cancel);
    process.removeListener('SIGINT', cancel);
    await app.close();
  }
}
export function cleanupStopped(operation: string) {
  return environmentMain(
    {
      operation,
      action: 'stop',
      kind: 'review',
      projectId: 1,
      mrIid: 1,
      pipelineId: 1,
      jobId: 1,
      sourceCommit: '0'.repeat(40),
    },
    true,
  );
}
