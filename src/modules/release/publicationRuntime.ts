import fs from 'node:fs';
import path from 'node:path';
import { nativeProcess, type ProcessRunner } from '../../common/runtime/process';
import { publicationCommand } from './command';
import { createEvidence } from './evidence';
import { createDockerHubPublisher } from './dockerhubPublication';
import { githubContext, githubGates } from './githubAcceptance';
import { publicationApi, publicationToken, publicationRecord } from './githubTransport';
import { lifecyclePolicy } from './lifecyclePolicy';
import type { GithubPublicationPorts } from './githubPublication.service';
import type { NpmPublicationPorts } from './npmPublication.service';
import type { SecurityProfile } from './types';
/** Configuration is read once at the standalone application boundary. */
export function readPublicationProfile(root: string): SecurityProfile {
  const profile = publicationRecord(
      JSON.parse(
        fs.readFileSync(path.join(root, 'config/gitlab/security-release.json'), 'utf8'),
      ) as unknown,
    ),
    runner = publicationRecord(profile.runner);
  for (const name of ['fromImage', 'toImage', 'jobCaBundleSha256']) {
    if (typeof profile[name] !== 'string') {
      throw Error('release-profile-required');
    }
  }
  for (const name of ['toImage', 'toVersion', 'helperImage']) {
    if (typeof runner[name] !== 'string') {
      throw Error('release-runner-profile-required');
    }
  }
  return profile as unknown as SecurityProfile;
}
/** Shared policy and authenticated ports for HTTP, CLI and CI publication adapters. */
export function createPublicationRuntime(
  profile: SecurityProfile,
  request: typeof fetch = fetch,
  processes: ProcessRunner = nativeProcess,
) {
  const lifecycle = lifecyclePolicy(),
    evidence = createEvidence(profile, lifecycle),
    images = createDockerHubPublisher(evidence),
    execute = publicationCommand(processes);
  const githubPorts: GithubPublicationPorts = {
    request,
    execute,
    images,
    upgrade: { evidence, lifecycle },
  };
  const npmPorts: NpmPublicationPorts = {
    processes,
    request,
    token: (env) => publicationToken(env, 'NPM_TOKEN'),
    async evidence(env, root, layout) {
      const ci = githubContext(env, root, images.context),
        origin = new URL(env.CI_API_V4_URL || '');

      if (
        origin.protocol !== 'https:' ||
        origin.username ||
        origin.password ||
        origin.search ||
        origin.hash
      ) {
        throw Error('Trusted GitLab API required.');
      }

      const gitlab = publicationApi(
        origin.href.replace(/\/$/, ''),
        publicationToken(env, 'SYSTEM_RELEASE_GITLAB_TOKEN'),
        'PRIVATE-TOKEN',
        request,
      );
      const jobs = await githubGates(ci, env, root, gitlab, layout);
      return {
        ...ci,
        jobs,
        artifact: async (jobId, file) => {
          const value = await gitlab(
            '/projects/' + ci.projectId + '/jobs/' + jobId + '/artifacts/' + file,
            { raw: true },
          );

          if (!Buffer.isBuffer(value)) {
            throw Error('native-release-artifact-required');
          }

          return value;
        },
      };
    },
  };
  return { evidence, images, execute, githubPorts, npmPorts };
}
