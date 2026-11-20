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
