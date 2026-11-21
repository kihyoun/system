import 'reflect-metadata';
import fs from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AdoptionModule } from './adoption.module';
import { AdoptionService } from './adoption.service';
export async function main(args: string[]) {
  const [command, inputFile, credentialFile, confirmation] = args;
  if (!command || !inputFile || !credentialFile || args.length > 4)
    throw Error(
      'Use plan or apply with an exact input, private credential file and confirmation hash.',
    );
  const input: unknown = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  const app = await NestFactory.createApplicationContext(
    AdoptionModule.register({ credentialFile }),
    { logger: false, abortOnError: false },
  );
  try {
    return await app.get(AdoptionService).run(command, input, confirmation);
  } finally {
    await app.close();
  }
}
