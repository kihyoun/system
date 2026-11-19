# Container compatibility and bounded logs

## Check the actual Docker host before choosing MongoDB

Containers share the Docker daemon host's kernel and exposed CPU instructions.
An Ubuntu release name or an image's userspace distribution does not establish
compatibility. Run the repository preflight **on that Linux x86_64 host** before
choosing a MongoDB image, changing a host kernel, or enabling a CI database:

```sh
python3 bootstrapper/container-preflight.py --mongodb-version 8.0.37
# Pull the exact reviewed digest separately, then test its executable as well:
python3 bootstrapper/container-preflight.py --mongodb-version 8.0.37 \
  --image 'docker.io/library/mongo@sha256:REPLACE_WITH_64_HEX_DIGEST'
```

The JSON report records `uname`, `/proc/version_signature`, the derived upstream
kernel, architecture and AVX visibility. Ubuntu's ABI release (for example
`7.0.0-30-generic`) is different from its upstream stable version (for example
`7.0.12` in the signature). Missing or inconsistent Ubuntu signatures fail closed.
The local socket is explicit; a remote Docker context cannot establish the remote
host's kernel or CPU. Keep this report with the application's selected server
version, immutable image identity and operational records. System Bootstrapper
itself does not provision MongoDB; application owners choose their databases.

The maintained rules cover MongoDB 7.0, 8.0, 8.3 and 9.0 and distinguish:

- Missing AVX on any exposed x86_64 CPU: investigate hardware/VM CPU passthrough.
- Linux upstream 6.19 through 7.0.13 with MongoDB 8/9: incompatible TCMalloc/rseq;
  older images may start and crash later. A successful `--version` cannot make
  that combination safe. MongoDB 7.0 is outside this particular kernel defect.
- Fixed upstream kernels with older server startup detection: the conservative
  reviewed floors are 8.0.37, 8.3.16 and 9.0.4, including Ubuntu detection fixes.
- Unknown release lines, missing kernel evidence, executable-version mismatch,
  explicit image kernel rejection, illegal instruction, timeout and other Docker
  or executable failures: separate diagnoses, never a generic “AVX missing”.

The optional image probe runs only after these checks pass. It uses a previously
pulled digest, `mongod --version`, no network, no persistent mounts, a read-only
root filesystem and bounded resources/time. It does not run a database, connect
to application data or alter a kernel. It verifies executable startup and reported
version; passing it is **not** a database workload test or a full vendor support
certification. AVX is necessary, not sufficient for the vendor's CPU matrix.

For planning, `--planned-kernel X.Y.Z` evaluates an explicitly supplied future
**upstream** kernel with the current CPU. It forbids an image probe, since an
image still runs on the current kernel. Before any deliberate kernel maintenance,
record every affected workload/version/image, verify current vendor support,
prepare matching configuration/data backups, confirm independently available
recovery images, and arrange a maintenance window and boot recovery path. After
boot, repeat current-host preflight and application checks before resuming use.
No tool here upgrades a kernel, reboots, changes a server version or bypasses
MongoDB's safety check. A database version change needs its own supported
migration and recovery procedure.

Rules must be reviewed against current primary sources when adding server lines
or changing kernel selections. The basis for the current checks is the
[MongoDB production notes](https://www.mongodb.com/docs/v8.0/administration/production-notes/),
[upstream kernel compatibility matrix](https://jira.mongodb.org/browse/SERVER-125742)
and [Ubuntu kernel detection fix](https://jira.mongodb.org/browse/SERVER-131779).
These are compatibility evidence, not an instruction to update a running host.

## Logging chain and retention convention

The platform's outer System NGINX routes public requests to an application proxy
and application web/API containers. Stock NGINX images link access/error logs to
stdout/stderr; Docker captures those streams for each container independently.
NGINX's main access format can include remote address, request time, method and
URL/query, status, byte count, referrer, User-Agent and forwarded addresses. Error
logs can also contain client addresses and request details. API log content is
application-defined and may include account identifiers or request payloads.
Avoid logging secrets, sensitive query parameters or unnecessary personal data;
application owners must inspect their actual image and format.

The default local diagnostic retention budget is `json-file`, **10 MiB per file,
three files per container**, rotating oldest files as new output fills the budget.
This is a size/count policy, approximately 30 MiB plus Docker bookkeeping and
individual log-record overhead per container, not a disk quota. It applies to
newly created System controller, web, Sync proxy, Wizard, GitLab stdout/stderr,
project Review/Beta/Production proxies and runner managers. Managed Wizard
Review/Beta containers use the same fixed default. Generated React, Angular and
web starter CI applies it to smoke tests and deployed application containers.

There is **no maximum age guarantee**: quiet containers can retain old entries
indefinitely; busy containers retain less history. No scheduled 14-day deletion
is configured. Privacy notices must describe this size/count behavior and any
separately operated log collection. An operator needing a calendar deletion
period must configure and verify a suitable logging/collection service and its
backups before promising that period. Reassess the diagnostic budget for each
application and incident-response need.

Docker file rotation covers only stdout/stderr. App-written files, remote log
collectors, host journal, CI job traces and GitLab's internal files have their own
retention controls. GitLab internal log files are stored in the selected
persistent directory and can also be retained inside completed Seeds; this
policy does not delete those files or retained backups. Do not point logrotate,
`truncate`, `rm` or a cleanup job at Docker-managed log files. See
[Docker's driver contract](https://docs.docker.com/engine/logging/drivers/json-file/).

## Configuration, deployment and verification

The Compose policy is explicit and does not edit `/etc/docker/daemon.json` or
change unrelated containers. To configure the core/proxy/runner budget, include
these literal exports in the **complete** private main configuration after its
unchanged Cube signature:

```sh
export SYSTEM_LOG_MAX_SIZE='10m'
export SYSTEM_LOG_MAX_FILES='3'
```

Use positive integer sizes with `k`, `m` or `g` units and a file count from 1 to
100. Validate desired values before applying them:

```sh
python3 bootstrapper/log-policy.py --max-size 10m --max-files 3
```

The Wizard's existing additional runtime options preserve these exports during
Fetch/Push and JSON/ZIP Backup/Open. Retain a matching configuration backup
separately from Harvest; the Seed preserves GitLab projects, variables and
application source, while Docker's own daemon log directory is not a Seed input.
Restore the matching configuration and Seed through the native recovery tools;
no logging override depends on a private host script or daemon default.

Starter project owners can edit `APP_LOG_MAX_SIZE` and `APP_LOG_MAX_FILES` in
their generated `.gitlab-ci.yml` or configured GitLab CI variables. These remain
project-owned settings, preserved in GitLab service-data backups and source
history. Existing editable pipelines are not overwritten automatically. For a
custom API, database or multi-container project, explicitly apply equivalent
logging options to **each** owned service in its project source:

```sh
docker run --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  YOUR_OTHER_REVIEWED_CREATE_OPTIONS YOUR_IMMUTABLE_IMAGE
```

A Docker restart, NGINX reload or daemon default change does not retroactively
configure an existing container. During the deliberate bundled deployment,
review Compose's planned recreation of affected platform services and their
outage/recovery requirements. Upgrade app-owned pipelines separately and let
their next normal deployment recreate only their owned containers. A running
application with old settings remains outside the new guarantee until that
recreation is verified. Never delete volumes, database files, Seeds or another
project's resources to apply logging settings.

Inspect exact container names on the daemon host after deployment, and repeat
after a subsequent normal deployment (use actual names from your deployment):

```sh
python3 bootstrapper/log-policy.py system_web_1 system_sync_1
python3 bootstrapper/log-policy.py --max-size 10m --max-files 3 YOUR_APP_CONTAINER
```

A mismatch exits 1 and displays the actual `HostConfig.LogConfig`; unavailable
Docker/invalid input exits 2. No container is changed. The default-only command
prints the expected policy without contacting Docker. For custom core settings,
supply the matching options explicitly or export the two `SYSTEM_LOG_*` values.
Do not print a private main configuration into a diagnostic report.

The socket-free component test is `python3 tests/bootstrapper/host-operations.py`.
Existing template, environment-helper, runner and configuration-roundtrip tests
also verify policy propagation. Candidate image preparation runs
`tests/bootstrapper/log-rotation-docker.js`: two disposable container generations
emit synthetic data, verify Docker readback rotation and stat only their own
three bounded log files. The existing native exporter/Seed restore probe verifies
that custom main-config logging values survive recovery. These checks do not
claim that any retained production container has already been recreated.
