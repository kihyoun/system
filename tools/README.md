# Bootstrap exceptions

This directory holds the explicitly permitted executable adapters that cannot
start as NestJS services. It is not a second implementation of platform operations.

## Quickstart

`quickstart/quickstart.sh` prepares the pinned Node runtime, verifies the accepted
release and hands control to the compiled NestJS CLI. The release publisher reads
this source to produce the downloadable installer. Runtime-only recovery uses
the same script with `--runtime-only vMAJOR.MINOR.PATCH`.

## GitLab initial credentials

The permitted GitLab adapter is limited to creating the first temporary
administrator token through GitLab's official Rails runner. Keep this adapter
under `gitlab/`. NestJS owns provisioning, credential storage and revocation;
the temporary token must be revoked after replacement credentials are verified.
Do not put credentials in this directory or commit generated credential files.

## Adding or changing adapters

Keep each adapter in a purpose-specific subdirectory and document its caller.
Operational Bash, Python and Ruby code must be replaced by shared TypeScript
services, not moved here. Native upstream executables remain external dependencies
invoked through typed process adapters. Immutable historical recipe fixtures keep
their original locations and bytes.
