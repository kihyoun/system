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

The [operation architecture and entry-point inventory](ARCHITECTURE.md) maps
API/CLI compatibility paths, privileges, durable ownership, native boundaries,
focused tests and failure/recovery responsibilities across the platform.

Portable project CI jobs can carry `wizard/.gitlab/runtime/project-ci.cjs` from
an exact source snapshot. This bundle creates the same `ProjectCiModule` standalone
Nest context and invokes its browser, environment and mirror services. It does not
fetch an npm runtime at job execution. Run with the pinned Node version; native
Docker/Git/SSH tools remain explicit job prerequisites. The accompanying
`LICENSES.txt` contains the bundled dependency licenses.

After preparing the pinned Wizard and operations dependencies, rebuild and verify
this source artifact from the compiled operations runtime:

```sh
npm --prefix operations run build
node operations/scripts/bundle-project-ci.mjs
node operations/scripts/bundle-project-ci.mjs --check
node --test operations/tests/project-ci.test.cjs
```

The check compares both runtime bytes and license notices. Source producers must
include these exact committed files in their approved source manifest; copying a
bundle from another candidate does not establish matching source provenance.

Starter React, Angular and Web projects use the same portable runtime with
`application build`, `application verify`, `application deploy review|beta|prod`
and `application stop review`. The committed `.system-bootstrapper/application-v2.json`
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
