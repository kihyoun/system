import { DeploymentSession } from './deployment-session';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ProjectLifecycleModule } from './project-lifecycle.module';
import { ProjectLifecycleService } from './project-lifecycle.service';
import { DeploymentAction, DeploymentPort, DeploymentSlot } from './types';
export async function execute<A extends DeploymentAction>(
  port: DeploymentPort,
  action: A,
  slot: DeploymentSlot,
  imageRef?: string,
): Promise<Awaited<ReturnType<DeploymentSession[A]>>> {
  const app = await NestFactory.createApplicationContext(ProjectLifecycleModule, { logger: false });
  try {
    return (await app
      .get(ProjectLifecycleService)
      .execute(port, action, slot, imageRef)) as Awaited<ReturnType<DeploymentSession[A]>>;
  } finally {
    await app.close();
  }
}
