# Initial GitLab credential boundary

`bootstrap-token.rb` is the narrow GitLab-native exception called by
`GitlabNativeApiService.bootstrap` through the installed GitLab Rails runner.
It creates one temporary `api` token for the existing active root administrator,
using GitLab's own model and token validation. The token expires the next day.
It accepts only a nonsecret 48-hex operation identifier through
`SYSTEM_BOOTSTRAPPER_AUTH_OPERATION` and returns credential material on its
private captured stdout. Do not invoke it in a pipeline, interactive console,
log collector or other caller that publishes stdout.

The script does not provision projects, create recurring identities, store
credentials, acquire project operation locks or perform recovery. Creation is
serialized on the existing administrator row, and an existing token name
(including a revoked token) refuses another creation for that operation. Those decisions
belong to the shared NestJS provisioning services. The caller must retain the
bootstrap credential privately, verify replacement credentials before switching
to them, and revoke the temporary token through GitLab's API when bootstrap work
is complete. An interrupted invocation can leave a token until its expiry;
process failure is not evidence that no token was created.

`GitlabAuthBootstrapService` records intent before invoking the native primitive.
Its private `GitlabAuthJournalService` stores `journal.json` beneath
`system-bootstrapper-auth/` in the mounted GitLab configuration directory:
`/srv/gitlab/config` in the controller and `/etc/gitlab` in GitLab. The directory
is mode `0700`; journal and lock are mode `0600`, owned by the controller UID.
Foreign owners, symlinks, hard-linked journal files and permissive modes are
rejected. The configuration volume travels with GitLab's database in Harvest
and Seed; this credential journal must not be included in configuration ZIPs.

`initial()` refuses an interrupted request instead of creating another token.
`reconcileInitial()` requires an independently authenticated administrator. It
locates the exact operation's root token, revokes it and verifies that result
before journalling a new operation. If no token is visible, it can replay only
the same operation identifier: atomic native duplicate prevention still permits
at most one creation. Ambiguous identities, incomplete API responses and lost
revocation responses preserve the journal for another explicit reconciliation.

`complete()` requires a verified, distinct administrator account and its active
`api` token before revoking the temporary root token. This recurring credential
is an administrator credential, not a project-restricted token. The method
persists the replacement before revocation, verifies revocation by exact token
ID, owner and name, then removes the temporary secret from the journal. A lost
revocation response resumes through readback, not another bootstrap operation.

This boundary does not authorize operational Ruby scripts or arbitrary Rails
commands. See GitLab's [personal access token guidance](https://docs.gitlab.com/user/profile/personal_access_tokens/).

`GitlabControllerCredentialService.prepare()` binds an administrator automation
account to an explicit username/email and a private ownership nonce in its GitLab
administration note. It refuses an unrelated existing username or changed
ownership attributes. This account is separate from the non-administrator
Renovate account. Its initial recurring token has only the `api` scope and a
90-day expiry; the account's administrator role still grants instance-wide
administrative authority. Project-specific credentials must be used where that
broader authority is unnecessary.

The service records each recurring-token creation intent before its REST call.
A lost response cannot recover the secret from GitLab. It therefore revokes and
verifies an exactly observed token before creating a replacement. If the
pending token is absent from the API, it retains the intent and refuses another
creation: absence alone does not establish that the original request cannot
still commit. Do not delete the private journal to bypass this barrier.

`GitlabControllerCredentialService.current()` verifies the saved account and
active credential on use. Within 14 days of expiry it creates a replacement
with the same 90-day policy, verifies its identity and scope, persists it, then
revokes and verifies the previous token. The private journal retains both token
identities while retirement is incomplete, so a lost revocation response can
resume without another issuance. If the saved administrator credential has
already expired or been revoked, the same method accepts a separately supplied
administrator credential for explicit recovery; that recovery secret is neither
stored in the journal nor returned. It never creates a new root token to work
around expiry.
