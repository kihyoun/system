import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ProjectLifecycleModule } from './project-lifecycle.module';
import { ProjectLifecycleService } from './project-lifecycle.service';
import { DeploymentAction, DeploymentPort, DeploymentSlot } from './types';
export async function execute(
  port: DeploymentPort,
  action: DeploymentAction,
  slot: DeploymentSlot,
  imageRef?: string,
) {
  const app = await NestFactory.createApplicationContext(ProjectLifecycleModule, { logger: false });
  try {
    return await app.get(ProjectLifecycleService).execute(port, action, slot, imageRef);
  } finally {
    await app.close();
  }
}
