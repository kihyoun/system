export function eligibility(env: NodeJS.ProcessEnv): string | undefined {
  if (env.GITHUB_BACKUP_ENABLED !== 'true') return 'not enabled';
  if (env.GITLAB_CI !== 'true') throw Error('GitLab CI context required');
  if (env.CI_PIPELINE_SOURCE !== 'push') return 'not a push pipeline';
  if (env.CI_COMMIT_TAG) return 'tag pipeline';
  if (!env.CI_DEFAULT_BRANCH) throw Error('default branch missing');
  if (env.CI_COMMIT_BRANCH !== env.CI_DEFAULT_BRANCH) return 'not the default branch';
  if (env.CI_COMMIT_REF_PROTECTED !== 'true') throw Error('protected default branch required');
  if (!env.GITHUB_BACKUP_SOURCE_PROJECT) throw Error('source project mapping missing');
  if (env.CI_PROJECT_PATH !== env.GITHUB_BACKUP_SOURCE_PROJECT)
    throw Error('source project mapping mismatch');
  return undefined;
}
export function remoteProtocol(remote: string, offline: boolean): 'ssh' | 'file' {
  if (remote.startsWith('git@github.com:')) {
    const repository = remote.slice('git@github.com:'.length);
    if (
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      repository.split('/').some((value) => ['.', '..'].includes(value))
    )
      throw Error('invalid GitHub SSH repository');
    return 'ssh';
  }
  if (!offline) throw Error('explicit GitHub SSH repository required');
  if (!/^(\/|[A-Za-z]:\/)/.test(remote)) throw Error('absolute offline repository required');
  return 'file';
}
