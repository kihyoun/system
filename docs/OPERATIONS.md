# System Bootstrapper CLI

You build it. You own it.

The CLI shares the platform's typed operation services. It does not start an HTTP
server. Use the CLI version distributed with your accepted System release.

With Node 24.22.0 and the matching npm toolchain available:

```sh
npm install --global --ignore-scripts @systembootstrapper/cli@2.0.0
```

This installs the CLI, not the platform. A fresh platform uses the repository's
Quickstart, which prepares its own pinned host runtime with nvm. Installation,
Harvest and restore require root on the selected Docker host; run only a reviewed
CLI version with explicit accepted source and image inputs.

```sh
system-bootstrapper --help
system-bootstrapper --version
```

Displaying help, the version or the welcome banner requires no installation
configuration, network connection or host tools and changes no platform state.

Storage operations require the installation's explicit persistence and Seed
selectors, native Docker tools and the accepted controller image. Prepare these
inputs using the host instructions before maintenance. A missing backup medium or
an incompatible image fails closed; it never creates a replacement Seed on the
system disk. See the repository handbook for the complete installation, backup
and recovery procedures.

For example, after preparing the accepted checkout, controller image and private
persistence selector, inspect a Harvest without copying data:

```sh
system-bootstrapper harvest \
  --checkout /opt/system-bootstrapper \
  --image YOUR_ACCEPTED_CONTROLLER_IMAGE \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --check-only
```

Replace the image placeholder with the accepted immutable image reference.
Check-only is a preflight, not a backup. Remove that flag only when you intend to
run Harvest. Restore uses the same selectors and optionally
`--configuration-backup /absolute/private/configuration.zip`. Preserve the matching
configuration separately from the Seed. Retain the runtime, source, image payloads
and backups before maintenance; reinstalling this package from npm is not an
offline recovery procedure.

The public package contains compiled operation code and its required validation
assets. It has no install-time scripts. Builds and publication run in GitLab;
GitHub provides the public source and accepted release documentation.

`system-bootstrapper upgrade` invokes the shared official-release upgrade
coordinator. Its `--operation plan|apply|status|recover` options use the same
reviewed plan, matching backup and retained checkpoint as the repository entry.
`system-bootstrapper controller-update` exposes the shared controller/Wizard
update and rollback operation for explicit candidate evidence. Neither command
starts an HTTP server or grants permission to deploy. Keep the version-specific
prerequisites and accepted artifacts described in the release and controller
guides; a controller rollback does not reverse a GitLab database migration.

To abort an interrupted promotion, use the retained checkpoint and the same
reviewed checkout and persistence configuration:

```sh
sudo system-bootstrapper promotion-abort --checkout /opt/system-bootstrapper \
  --checkpoint-dir /path/to/retained/checkpoint \
  --persistence-env /etc/system-bootstrapper/persistence.env
```

This invokes the shared recovery service without starting an API server. It
checks recorded ownership and retained images before recovery. An uncertain
operation keeps its leases and checkpoint for reconciliation; do not delete
those files to force a retry. This command does not reverse a GitLab database
migration.

`system-bootstrapper recovery-export` invokes the same shared host service as the
repository recovery-export entry. Supply the reviewed absolute checkout, private
release/evidence inputs, configured GitLab URL, token file and output path described
in the controller reference. The command retains accepted image bytes and source
identities; it does not perform a Harvest. `system-bootstrapper gitlab-credentials
--help` describes the private automation credential lifecycle in the controller
mount namespace. Its successful output contains account/token metadata only.
The CLI and controller ship the same source-owned lifecycle evidence validators
as explicit package assets, so offline recovery does not load missing code from
outside the installed package. Packaging checks compare those bytes with source.

`system-bootstrapper recovery verify|load --checkout /absolute/reviewed/source
--directory /absolute/retained/recovery` shares the offline manifest and image
services. `verify` audits the manifest; `load` reconstructs its accepted image
identities without starting services. `--configuration` additionally checks the
selected configuration. Legacy `--checksums-only` supports audit only, and cannot
load images or approve configuration. Preserve the independently recorded manifest
hash and supply it with `--expected-manifest-sha256` when available.

The [operation architecture and entry-point inventory](ARCHITECTURE.md) maps
API/CLI compatibility paths, privileges, durable ownership, native boundaries,
focused tests and failure/recovery responsibilities across the platform.

Current System, Wizard and generated project jobs invoke the ordinary
`system-bootstrapper project-ci` command. Its thin CLI adapter creates the shared
Nest `ProjectCiModule`; browser checks, builds, verification, deployment and
cleanup use the same services as the controller. Node, npm and native tools remain
explicit pinned job prerequisites.

A source export carries the **regular bundled npm package** from that same build,
its SHA-256 and a receipt binding package version, System Git revision and Git tree.
The tarball remains outside its own npm payload. The explicit
`SYSTEM_CLI_ARTIFACT` absolute path selects the retained archive;
`SYSTEM_CLI_RECEIPT` optionally selects its receipt (default: archive path plus
`.json`). Missing or mismatched input fails closed. Archives are limited to 8 MiB. Jobs checksum the exact local
archive and install it with `npm install --offline --ignore-scripts`; registry
publication and a floating package version are not required.

From a clean reviewed checkout, install the exact Node/npm versions in
`package.json`, run `npm ci --ignore-scripts --no-audit --no-fund` and prepare the
local package before exporting source:

```sh
npm run build
mkdir -p .ci-cli-package
npm pack --offline --ignore-scripts --pack-destination .ci-cli-package
npm install --offline --ignore-scripts --no-audit --no-fund --no-package-lock --prefix .ci-cli "./.ci-cli-package/systembootstrapper-cli-$(cat VERSION).tgz"
export PATH="$PWD/.ci-cli/node_modules/.bin:$PATH"
system-bootstrapper project-ci package "$PWD" "$PWD/assets/cli-companion"
export SYSTEM_CLI_ARTIFACT="$PWD/assets/cli-companion/systembootstrapper-cli-$(cat VERSION).tgz"
system-bootstrapper project-ci artifact-check "$SYSTEM_CLI_ARTIFACT"
system-bootstrapper source-prepare "$PWD"
node --test tests/operations/project-ci.test.cjs tests/operations/project-ci-artifact.test.cjs
```

Alternatively install an already reviewed regular CLI tarball into an explicitly
selected npm prefix and add its `node_modules/.bin` directory to `PATH`. Preserve
the original companion bytes and receipt; reinstalling and repacking does not prove
identical bytes. Candidate controller images retain their selected package under
`/opt/system-bootstrapper/cli-artifact`; standalone npm users must supply a
matching companion explicitly before source/project export.

SourceSnapshot v3 adds the derived `.gitlab/cli` package, checksum and receipt
and native `.gitlab/build-v3` Docker/lock inputs to the committed Wizard source. Snapshots v1/v2 keep their original strict contracts.
The current `node24-vite8-cli-v7` recipe binds the archive hash and uses
`.system-bootstrapper/build-v3`; existing reservations, including the frozen
`typed-v6/runtime` artifact, keep their exact historical bytes. Use the guarded
source/toolchain or source-primary migration with an explicit v7 profile and the
matching source to update an existing project. Controller replacement alone does
not update a reservation.

Starter React, Angular and Web projects use the same regular CLI package with
`system-bootstrapper project-ci application CHECKOUT build|verify` and
`system-bootstrapper project-ci application CHECKOUT deploy review|beta|prod` or
`stop review`. The committed `.system-bootstrapper/application-v2.json`
records the project key and enabled hosts. Build jobs pass an immutable registry
digest through `app-image.env`; HTTP verification checks the project identity in
the served page before deployment jobs can run. The application is a normal SPA,
not a Nest application.

Deployment requires the platform's existing project/environment network. A
successful deployment transfers the exact container to its persistent application
owner; failed starts clean only resources created by that job. Replacement and
stop require the exact project/container owner label and full container ID.
Unlabelled historical containers are refused and require an explicit migration;
editing a starter does not authorize deleting unrelated resources or replacing
an existing project's CI files.
