import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ReleaseModule } from './release.module';
import { GithubPublicationService } from './githubPublication.service';
import { NpmPublicationService } from './npmPublication.service';
import { createPublicationRuntime, readPublicationProfile } from './publicationRuntime';
import { publishSuccessor } from './successorPublication';
export type ReleaseAction = 'successor' | 'dockerhub' | 'github' | 'package-cli' | 'npm';
export async function releaseMain(
  action: string = process.argv[2] || '',
  root = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): Promise<unknown> {
  if (!['successor', 'dockerhub', 'github', 'package-cli', 'npm'].includes(action)) {
    throw Error('release-action-required');
  }

  const runtime = createPublicationRuntime(readPublicationProfile(root), request);

  if (action === 'successor') {
    return publishSuccessor(runtime.evidence, runtime.execute, environment, root);
  }

  if (action === 'dockerhub') {
    return runtime.images.publish(environment, root, runtime.execute);
  }

  const npm = action !== 'github';
  const app = await NestFactory.createApplicationContext(
    npm
      ? ReleaseModule.registerNpm(runtime.npmPorts)
      : ReleaseModule.registerGithub(runtime.githubPorts),
    { logger: false, abortOnError: false },
  );
  try {
    if (!npm) {
      return await app.get(GithubPublicationService).publish(environment, root);
    }

    const service = app.get(NpmPublicationService);
    return action === 'package-cli'
      ? service.prepare(root, environment)
      : await service.publish(environment, root);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void releaseMain()
    .then(() => console.log('Accepted release operation completed.'))
    .catch(() => {
      console.error(
        'Release operation refused; verify protected source, accepted artifacts, immutable destinations and publisher credentials.',
      );
      process.exitCode = 1;
    });
}
