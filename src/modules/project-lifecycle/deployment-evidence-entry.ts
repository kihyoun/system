import 'reflect-metadata';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DeploymentEvidenceModule } from './deployment-evidence.module';
import {
  DeploymentEvidenceService,
  type DeploymentEvidenceKind,
} from './deployment-evidence.service';
import { accepted, row } from './evidence-common';
export async function deploymentEvidenceMain(kind: string) {
  accepted(['environment', 'production', 'beta', 'review'].includes(kind));
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    accepted(size <= 8 * 1024 * 1024);
    chunks.push(bytes);
  }
  const payload = row(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  accepted(
    Object.keys(payload).every((key) => ['input', 'binding'].includes(key)) && 'input' in payload,
  );
  const app = await NestFactory.createApplicationContext(DeploymentEvidenceModule, {
    logger: false,
    abortOnError: false,
  });
  const controller = new AbortController(),
    cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    return await app
      .get(DeploymentEvidenceService)
      .verify(
        path.resolve(__dirname, '../../..'),
        kind as DeploymentEvidenceKind,
        payload.input,
        payload.binding,
        controller.signal,
      );
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
    await app.close();
  }
}
if (require.main === module) {
  if (process.argv.length !== 3) process.exitCode = 1;
  else
    void deploymentEvidenceMain(process.argv[2])
      .then((result) => console.log(JSON.stringify(result)))
      .catch(() => {
        console.error('Canonical deployment evidence could not be verified.');
        process.exitCode = 1;
      });
}
