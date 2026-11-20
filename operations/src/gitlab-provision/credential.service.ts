import { Injectable } from '@nestjs/common';
import { GitlabAuthBootstrapService } from './auth-bootstrap.service';
import { GitlabAuthJournalService } from './auth-journal.service';
import { GitlabControllerCredentialService } from './controller-credential.service';
import { GitlabNativeContextService } from './native-context.service';
import type { GitlabNativeContext } from './native-api.service';
export interface GitlabCredentialOptions {
  checkout: string;
  configDirectory?: string;
  identity?: { username: string; email: string };
  signal?: AbortSignal;
}
const defaultIdentity = {
  username: 'system-bootstrapper-controller',
  email: 'system-bootstrapper-controller@system-bootstrapper.invalid',
};
/** Common credential lifecycle for authenticated Sync operations and the operator CLI. */
@Injectable()
export class GitlabCredentialService {
  constructor(
    private readonly contexts: GitlabNativeContextService,
    private readonly bootstrap: GitlabAuthBootstrapService,
    private readonly controller: GitlabControllerCredentialService,
    private readonly journals: GitlabAuthJournalService,
  ) {}
  async ensure(options: GitlabCredentialOptions) {
    const directory = options.configDirectory ?? '/srv/gitlab/config';
    const context = await this.contexts.resolve(options.checkout, directory, options.signal);
    const state = await this.bootstrap.initial(context, directory);
    if (
      options.identity &&
      state.account &&
      (options.identity.username !== state.account.username ||
        options.identity.email !== state.account.email)
    )
      throw Error('gitlab-controller-identity-binding-mismatch');
    if (state.phase === 'bootstrap-received') {
      const replacement = await this.controller.prepare(
        context,
        directory,
        state.account ?? options.identity ?? defaultIdentity,
      );
      await this.bootstrap.complete(context, directory, replacement);
    } else if (state.phase === 'replacement-verified') {
      await this.bootstrap.complete(context, directory, state.replacement!);
    }
    return this.current(context, directory);
  }
  async renew(options: GitlabCredentialOptions, recoveryAdministrator?: string) {
    const directory = options.configDirectory ?? '/srv/gitlab/config';
    const context = await this.contexts.resolve(options.checkout, directory, options.signal);
    return this.current(context, directory, recoveryAdministrator);
  }
  async reconcileInitial(options: GitlabCredentialOptions, administrator: string) {
    const directory = options.configDirectory ?? '/srv/gitlab/config';
    const context = await this.contexts.resolve(options.checkout, directory, options.signal);
    await this.bootstrap.reconcileInitial(context, directory, administrator);
    return this.ensure(options);
  }
  private async current(
    context: GitlabNativeContext,
    configDirectory: string,
    recoveryAdministrator?: string,
  ) {
    const credential = await this.controller.current(
      context,
      configDirectory,
      new Date(),
      recoveryAdministrator,
    );
    const account = await this.journals.withJournal(
      configDirectory,
      async (journal) => journal.read()?.account,
    );
    if (!account || account.userId !== credential.userId)
      throw Error('gitlab-controller-account-missing');
    return {
      context,
      configDirectory,
      credential,
      account: { id: account.userId, username: account.username, email: account.email },
    };
  }
}
