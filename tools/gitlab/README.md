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
