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

Source-primary environment activation uses the historical project PostgreSQL
advisory key through `GitlabActivationSessionService`. A private
`project-<id>.json` journal binds the operation, exact GitLab container, detached
Docker execution ID, command/user digest and PostgreSQL backend identity. The
native `psql` holder runs independently of the controller process; losing an HTTP
mutation response retains the lock and pending variable write. Retrying the same
operation checks the exact variable value and flags before continuing. A different
operation cannot take over that journal. PostgreSQL ownership is checked using
the nonce, database/user, advisory key, PID and backend start time before any
write or cancellation. No timeout releases an uncertain mutation barrier.

The holder is created without starting it, then its exact execution ID is saved
before starting. Retrying that ID cannot launch a second process. Release records
intent before cancelling the verified backend and confirms both that the lock is
gone and that its Docker execution has stopped (or has been garbage-collected).
Interrupted release is reconciled on the next same-operation attempt. A pending
write whose expected value cannot be verified remains blocked; deleting the
journal or cancelling an unrelated database session is not a recovery procedure.

## Controller credential commands

Run these commands inside the running controller, with its prepared Node runtime
and accepted checkout. The controller must see the same GitLab configuration
volume at `/srv/gitlab/config` that the owned GitLab container mounts read-write
at `/etc/gitlab`. The service verifies the container's exact ID, Compose ownership
and matching filesystem device/inode before opening any credential journal.
`--config-directory /absolute/path` selects a different local mount of that same
volume; it cannot select an unrelated private directory.

```sh
node operations/dist/gitlab-provision/entry.js initialize --checkout "$PWD"
node operations/dist/gitlab-provision/entry.js renew --checkout "$PWD"
```

Initialization reserves `system-bootstrapper-controller` with the non-delivery
address `system-bootstrapper-controller@system-bootstrapper.invalid`. The account
is an administrator with a random password, skipped email confirmation and a
private profile. An existing account with that name is never adopted by name
alone. To select an organization-specific identity, supply both `--username`
and `--email` on the first initialization; later calls retain that binding.
The commands print account ID/name, token ID and expiry, never the token itself.
They share the credential service used by operation callers.

For an expired or revoked recurring credential, create an independently authorized
administrator token using your GitLab administrator account and place it in a
private, operator-owned regular file with mode `0600`. Supply its absolute path:

```sh
node operations/dist/gitlab-provision/entry.js renew --checkout "$PWD" \
  --administrator-token-file /absolute/private/recovery-token
```

After a lost initial token response, use `reconcile-initial` with the same private
file option. The command reconciles the recorded initial operation before completing
the handoff; it does not delete or replace the journal to bypass ownership checks.
Remove the recovery file and revoke the operator-supplied token after successful
recovery. It is not persisted as the controller credential. A lost recurring-token
creation with no matching token yet visible still refuses another issuance;
retain the journal and retry the same command after GitLab has completed the
original request. Do not mint repeated replacements to bypass uncertain completion.

Restore the GitLab database and configuration volume from the same completed Seed.
The restored credential must still be verified against the restored account and
its ownership nonce; an unrelated configuration ZIP cannot reconstruct this
private authority. If a restored token is expired, use the explicit renewal
recovery above. No root-token rebootstrap is performed for routine renewal.

## Project activation authority

Source-primary environment activation and its status operation share
`SourcePrimaryOperationService` between the Sync API and the Node activation
entry point. Project identity and managed configuration are validated before
issuing a project credential. The existing Wizard payload and result are retained;
no administrator token is sent to the browser or stored in its configuration.

`GitlabProjectCredentialService` stores each exact project ID/path binding in
`project-credentials-<id>.json` beside the controller journal. It creates a
project access token with Maintainer access level `40` and only the `api` scope.
This grants project API authority, not merely permission to change four variables.
The dedicated administrator is used for this credential lifecycle; the actual
activation requests use the project token. Before use, the service verifies the
GitLab-created project bot, marks it external and verifies that state. This
prevents the internal-project visibility that an internal creator can otherwise
confer on a project access token. See GitLab's
[project token documentation](https://docs.gitlab.com/user/project/settings/project_access_tokens/)
and [project token API](https://docs.gitlab.com/api/project_access_tokens/).

Project credentials use the same 90-day expiry and 14-day renewal window.
Creation intent is saved before the request; an uncertain response cannot cause
another issuance until the exact observed orphan has been revoked. Replacement
credentials are persisted and verified before retiring the old token. A changed
project path, permission level, bot identity or external-user status refuses
ordinary use. For deliberate credential replacement, first restore the correct
project binding and run:

```sh
node operations/dist/gitlab-provision/entry.js renew-project --checkout "$PWD" \
  --project-id YOUR_PROJECT_ID --project-path YOUR_GROUP/YOUR_PROJECT
```

This command deliberately replaces the bound project credential, verifies the new
one and revokes the previous one. It outputs metadata only and does not change
project source, CI variables or deployment state. If the controller administrator
credential itself needs recovery, complete `renew` first. Pending issuance still
requires exact reconciliation; this command cannot bypass its private journal.
