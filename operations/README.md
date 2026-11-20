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

The [operation architecture and entry-point inventory](ARCHITECTURE.md) maps
API/CLI compatibility paths, privileges, durable ownership, native boundaries,
focused tests and failure/recovery responsibilities across the platform.
