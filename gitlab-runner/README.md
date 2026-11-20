# Runner persistence

The prepared native `operations/dist/lifecycle/entry.js runner-start CHECKOUT`
entry invokes the shared `RunnerLifecycleService`, which
reads the platform's `PERSISTENT_DIR` and generates a Compose service
for each runner manager. Manager `runner_docker_1` binds:

- `PERSISTENT_DIR/runners/runner/1/config` to `/etc/gitlab-runner`;
- `PERSISTENT_DIR/runners/runner/1/home` to `/home/gitlab-runner`.

Project pools use `runners/<project>_runner/<index>/` instead. Each manager keeps
its own `config.toml`, runner system ID and home. The runner image's declared
volumes therefore do not create anonymous storage. Do not scale the template
service directly: its bind mounts cannot distinguish individual managers.

Each pool uses one GitLab runner record and authentication token. Its managers
have distinct system IDs; GitLab lists them under the runner's **Runner managers**
section rather than as separate runner records. Saved per-manager configuration
keeps those identities stable across restarts.

Counts from zero through 50 are supported. Shrinking removes the excess
containers while retaining their directories; growing reuses those directories.
The `runner-stop` action also retains registration and data. Run `runner-unregister` explicitly only
when intentionally removing registration. The generated Compose file is
temporary; its paths are deterministic and reconstructed on each invocation.

When invoking these entries inside the bootstrapper, mount the host's
`PERSISTENT_DIR` at the same absolute path inside the container. Runner directories
are prepared there before the host Docker daemon mounts them. The platform must
check that the persistent volume is mounted before startup. A migration from
anonymous volumes must copy each existing manager's config and home into its
corresponding directory before replacing its container.

`provision.js` writes the main configuration under `SYSTEM_CONFIG_DIR` when set
(the controller uses `/state`). This preserves the legacy configuration symlink
when atomically recording a newly provisioned runner token.

Registration passes the token through Docker's named environment option; the token
is never part of process argv. Endpoint migration copies a private mode-600 file
and atomically renames it inside the managed runner. Failed copies preserve the
previous configuration. An interrupted remote copy/rename retains its uniquely
named temporary file and the startup recovery barrier until ownership is settled.

Run the lifecycle regression in the built controller image too, since its
BusyBox utilities differ from the Debian component-test image. Set
`BOOTSTRAPPER_IMAGE` to the exact controller image you built:

```sh
docker run --rm --network none --read-only --tmpfs /tmp:exec \
  -v "$PWD:/work:ro" -w /work --entrypoint node \
  "$BOOTSTRAPPER_IMAGE" tests/gitlab-runner/persistence.js
```

This uses the runtime's actual temporary filesystem, without Docker access or live state.
Build the operations package before running the compatibility commands. Runner
setup shares the persistent controller lease; an inherited upgrade must supply
its exact operation identity and remain the live ancestor of the runner command.

Native provisioning uses the shared GitLab controller credential and REST API.
It preserves an existing instance runner only after verifying its policy and an
exactly owned manager configuration/token, or a private saved credential receipt.
The receipt is under `/srv/gitlab/config/system-bootstrapper-auth/runner.json`,
inside the GitLab configuration volume included by Harvest/Seed. It must stay
private; do not copy it into a configuration ZIP. Existing configured runner
tokens remain supported. Normal startup never resets an unavailable token.

If the old token cannot be recovered, explicitly rotate the exact runner ID in
the prepared controller mount namespace:

```sh
node operations/dist/lifecycle/entry.js runner-rotate "$PWD" RUNNER_ID ROTATION_OPERATION
```

Replace `RUNNER_ID` with the existing instance runner's numeric ID and
`ROTATION_OPERATION` with a new 48-character lowercase hexadecimal operation ID.
Retain that ID until recovery finishes and use the **same** value for every retry.
The controller must have its normal `PERSISTENT_DIR`, GitLab configuration and
`SYSTEM_CONFIG_DIR` mounts. This command shares the persistent startup barrier
and runner-registration lock. It stops exactly owned existing main-pool manager
containers, resets the token once, updates the private receipt, manager tokens and
main configuration, and leaves managers stopped. Schedule this operation when
jobs may be interrupted. It preserves the runner record, configuration fields and
manager system IDs; it does not unregister managers. Restart through
`node operations/dist/lifecycle/entry.js runner-start "$PWD" main` after success.

An interrupted request retains its exact Docker exec ID and private response
files. For a normally returned failure without a retained startup barrier, repeat the
same operation. If the startup barrier was retained after interruption, use:

```sh
node operations/dist/lifecycle/entry.js runner-reconcile "$PWD" STARTUP_OPERATION ROTATION_OPERATION
```

`STARTUP_OPERATION` is `startup-` followed by the operation from the private
`SYSTEM_CONFIG_DIR/.storage-operation-lock/startup-owner.json` receipt. This file
contains ownership metadata, not credentials. For interrupted initial runner
provisioning, use the literal `provision` as the final argument instead of a
rotation operation. Reconciliation verifies the matching runner journal and exact
Docker exec, and requires the previous owner to be dead using boot, PID start and
PID namespace identity. It reuses the existing barrier; it never deletes a foreign
storage/upgrade lock. Old receipts without process proof and same-boot namespace
changes remain refused. It recovers the saved response rather than issuing
another reset. A different operation is refused while one is pending. If curl
finishes without a complete response, or the recorded exec disappears before its
result is recovered, the command fails closed and retains the receipt. Restore a
matching Harvest/Seed snapshot before retrying; deleting the pending journal or
blindly issuing another reset is not recovery. Conflicting or unreadable manager
configuration is also refused rather than adopted or overwritten.
