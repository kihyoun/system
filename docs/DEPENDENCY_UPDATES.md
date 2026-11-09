# Approval-controlled dependency updates

Renovate OSS runs as the scheduled `renovate:discover` GitLab job on the existing
Docker runner pool. Its reviewed stable `44.222.5-full` image is pinned by digest
in `.gitlab-ci.yml`; update it through review like other dependencies. There is no
permanent bot service. Its [repository configuration](../renovate.json) and
[self-hosted configuration](../gitlab/renovate/config.cjs) select only the two
operator-supplied System and Wizard source projects, never GitHub mirrors or
project autodiscovery.

## Operator setup

Use a reviewed checkout after merging the configuration into the protected default
branches of both projects. Python 3 with normal HTTPS CA trust is sufficient.
Keep a GitLab administrator API token in a mode-0600 file outside the checkout.
It is used only by the operator provisioning command; it never enters CI. Use a
real operator-controlled email address for the dedicated account.

Create a mode-0600 JSON input outside the checkout, for example:

```json
{
  "endpoint": "https://gitlab.example.com/api/v4",
  "admin_token_file": "/secure/operator/gitlab-admin-token",
  "username": "dependency-bot",
  "email": "dependency-bot@example.com",
  "project_ids": [10, 11],
  "state_file": "/secure/operator/renovate-state.json",
  "cron": "0 4 * * 1",
  "timezone": "UTC"
}
```

Replace all values: System is first and Wizard second. The namespace paths are
resolved from those IDs. The tool refuses an account it does not recognize,
administrator identity, unrelated memberships/tokens, or Developer push access to
either protected default branch. A private ownership journal binds the bot's user
ID to the endpoint, username, private email and project selection. Before account
creation it records a random nonce, also written to the administrator-only user
note, so an interrupted creation can resume safely. Matching a public display name
alone never authorizes adoption. Existing-user identity, restrictions, memberships
and token checks all precede existing-user API writes. The bot receives a random
unknown password with no password-reset email; it uses its PAT for operations. Keep both default branches protected against
Developer pushes. The dedicated account has Developer membership in those two
projects only, no group membership, group creation or personal project allowance.
It uses an `api` personal access token, needed for private repository branches,
MRs and dashboard issues. Project membership limits that token's project access;
it is not an administrator token.

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json --apply
```

The first invocation validates private file handling without API mutations. The
second reconciles the account, Developer memberships, protected CI variables and
one **paused** weekly schedule. `RENOVATE_TOKEN` is protected and masked;
`RENOVATE_REPOSITORIES` is protected and contains only the two explicit paths.
The schedule runs the protected System default branch with `RENOVATE_ENABLED=true`.
The provisioning operator takes ownership of the schedule and must be authorized
to run pipelines on that branch; a Developer bot does not receive protected-branch
merge/push rights. Ensure the configured runner serves the protected branch.

Record the first-run branch/MR inventory before activating it. This uses the
scoped bot token in private state; it does not write to GitLab:

```sh
python3 gitlab/renovate/verify.py --config /secure/operator/renovate.json \
  --baseline /secure/operator/renovate-first-discovery.json
```

After reviewing both repository configs, activate it:

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json --apply --enable
```

The command is repeatable. Keep its mode-0600 state file private: it contains the
bot token for interruption-safe reconciliation. It never prints the token or API
response bodies. The weekly cron and timezone are configurable in the input.
Running without `--enable` pauses the owned schedule without deleting dashboards,
branches or reports. Re-running with `--enable` resumes it. Do not add a global
`RENOVATE_ENABLED` selector to ordinary pipelines. Only the protected scheduled
pipeline selects the bot job; normal merge requests, default-branch pushes and
protected version tags retain their applicable required gates and publishers.

## Discovery, approval and grouping

The initial run creates or refreshes a Dependency Dashboard in each source
project. `dependencyDashboardApproval=true` is enforced globally, including
security proposals and lockfile maintenance: **no update branch or MR is created
before dashboard approval**. Confirm that the first run has only these dashboards
and no new `renovate/` branch/MR. After the first successful owned schedule run,
verify both dashboards, unchanged branch/MR inventories and that the scheduled
pipeline contained only the successful bot job:

```sh
python3 gitlab/renovate/verify.py --config /secure/operator/renovate.json \
  --baseline /secure/operator/renovate-first-discovery.json --verify
```

Use a quiet initial discovery window: concurrent human branch/MR creation also
fails this strict comparison and must be investigated. Approve a specific displayed batch by selecting
its checkbox, then run or await the next scheduled discovery. The blanket
"create all" checkbox can approve many proposals; select individual batches when
coordinating delivery.

Compatible npm patch/minor/pin changes share one npm batch per project. Compatible
runtime-image/digest changes share a runtime batch. Major changes remain separate.
Npm manages manifests with their npm lockfiles; lockfile refresh requires approval
too. Native Dockerfile, Compose and GitLab CI managers cover image references;
narrowly scoped regex managers cover the `ARG IMAGE=node:...@sha256:...` pin
in `system/Dockerfile`, the Runner registration Docker CLI default and the
current Wizard build/verify BuildKit driver pins. Grouping is per repository, not a cross-project transaction.
Maintainers combine accepted Wizard changes with the System gitlink and other
agreed work in a reviewed System candidate.

Updates remain stable-only; Node and Docker retain reviewed major lines. GitLab,
Runner and Helper image updates are deliberately disabled in ordinary bot rules.
Use the paired [GitLab upgrade procedure](HANDBOOK.md#migrate-gitlab-through-the-accepted-controller), its required stops,
migration evidence and rollback checkpoint. Historical build recipes, recorded
security-release transitions, recovery identities and saved operator-selected
Production images are not dependency-update targets. The bot cannot silently
rebase those records to a new upstream release. Its proposals do not change a
running installation. Automatic merge is disabled; merging and Production promotion
remain separate maintainer/operator decisions using the existing gates and tools.

## Expiry, rotation and recovery

Tokens expire after 90 days. Arrange an operator reminder before expiry; the setup
command rotates when fewer than 15 days remain, or explicitly:

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json --apply --rotate --enable
```

It saves the new token privately, updates the protected variable, then revokes
obsolete tokens owned by this tool. If interrupted, rerun it; no unrelated token
is revoked. On failure it does not dump secret-bearing API bodies. Review the
schedule's next-run time and confirm the next run refreshes both dashboards.

A normal host replacement with retained GitLab data or a matching completed Seed
restores GitLab's database-backed account, memberships, protected variables,
schedules, dashboard issues and MRs. Restore the matching GitLab configuration and
secrets required to decrypt database values using the [recovery contract](RECOVERY_CONTRACT.md).
Fresh runner managers/caches/workspaces are reconstructed, not backed up as bot
state. The reviewed checkout restores the CI/configuration/tooling. Pause schedules
during recovery; restore runner reachability and CA trust before enabling them.

The operator input/token-state files are outside the checkout and are not included
in a configuration-only Wizard export. Keep them in protected operator storage.
If only token state is lost but the restored account remains, restore its private
journal when possible. Otherwise an administrator must verify the intended bot
user ID, configured private email and restricted account, then explicitly recover:

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json \
  --apply --recover-user-id 123 --rotate
```

Replace `123` with the independently verified user ID. This remains paused,
rejects mismatched identity, extra memberships/tokens or unrestricted account
properties before API writes, establishes a new private ownership journal and
rotates the token before revoking obsolete owned tokens. Re-record a first-run
baseline and enable after review. It never adopts an account using its name alone. A fresh empty GitLab
instance needs its two source projects, protected branches, dedicated identity,
memberships, token variables and schedule provisioned again; numeric IDs may change.
An expired/revoked token remains unusable after restoring a database. Never reuse
a current administrator token as the bot CI secret. Losing a schedule owner can
require another authorized maintainer to take ownership before it runs.

## Verification

Run the regular lightweight configuration/setup tests through the component test
suite. For the actual pinned Renovate engine, run the isolated functional fixture:

```sh
docker run --rm --network none --entrypoint node \
  -v "$PWD:/work:ro" -w /work \
  ghcr.io/renovatebot/renovate:44.222.5-full@sha256:1e5baa47058a74b5f41e425838862f6728b4351790d8278f1356df2e56e8df62 \
  tests/gitlab/renovate-functional.mjs /usr/local/renovate/dist
```

It uses fabricated dependencies and an in-memory platform, never live credentials
or repositories. It exercises the real engine's rule matching, grouping,
unapproved branch gate and dashboard output. Also validate both configs with
`renovate-config-validator --strict --no-global renovate.json wizard/renovate.json` from that image. Post-merge operators verify
the first live discovery separately: only `renovate:discover` is selected, both
dashboards exist, and branch/MR inventories are unchanged until explicit approval.

Upstream references: [GitLab platform](https://docs.renovatebot.com/modules/platform/gitlab/),
[dashboard approval](https://docs.renovatebot.com/configuration-options/#dependencydashboardapproval),
[self-hosting](https://docs.renovatebot.com/getting-started/running/).
