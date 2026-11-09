# Changelog

Versions follow [Semantic Versioning](https://semver.org/). A version belongs to
one accepted System source revision and tested controller/Wizard image attempt.

## 1.1.1

### Fixes

- Start the guided preview import's native default-branch pipeline before
  transferring historical branches and tags. Preserve exact source history,
  safe partial-import resumption and operator changes without starting obsolete
  historical pipelines or inheriting Auto DevOps for newly imported projects.
- Allow authenticated configuration ZIP downloads from the private backup
  directory while retaining helper-completion, file-type and checksum checks.
- Handle a process exiting during upgrade-watchdog inspection without hiding
  unrelated I/O or permission failures or weakening operation ownership checks.
- Bound disposable GitLab web workers through its supported configuration so
  nested test platforms retain their CPU and memory limits on larger hosts.

### Upgrade and recovery

- Existing configuration and Seed formats remain unchanged. Use the reviewed
  paired controller/Wizard update and retain the previous images and matching
  recovery inputs before promotion.

## 1.1.0

### Features

- Optional guided setup for a fresh installation's Wizard Review and Beta
  environments, using explicit project/host selection and real source, build and
  browser evidence while retaining the accepted public Production image.
- A coordinated Harvest and configuration ZIP workflow, with exact backup-pair
  metadata, resumable downloads and clear partial-failure status.
- Read-only operational credential expiry, renewal guidance and on-demand
  configured registry/runner diagnostics in the connected Wizard.

### Interface and documentation

- A shorter Overview introduction and a slightly smaller slogan, in English,
  German and Korean, with the existing installation actions preserved.
- Integrated guides for previews, backup pairs, credential expiry and
  connectivity diagnostics in all three languages.
- Korean as an additional Wizard language, including the complete integrated
  handbook, with the English repository documentation retained as the source.

### Upgrade and recovery

- Existing configuration and Seed formats remain supported. Preview intent and
  recovery metadata stay descriptive; imports do not provision or deploy services.
- Back up configuration and persistent data through the native procedures before
  promotion. Retain the previous accepted images and matching recovery inputs.

## 1.0.0

The first supported System product release establishes the public contract; it
does not renumber historical source commits or earlier image publications.

### Features

- Public accepted-release metadata, GitHub release notes and a thin Ubuntu
  Quickstart using the tested controller and matching Wizard by immutable digest.
- Configuration JSON/ZIP recovery metadata and a readable restore guide, with
  saved image settings separated from available running-image observations.
- Concise installation entry points and integrated operator documentation.

### Fixes and security

- Maintained dependency and runtime image pins with required native checks.
- Protected, retry-safe public publication without rebuilding accepted images.

### Upgrade and recovery

- Existing installations use the native reviewed controller promotion and GitLab
  migration tools; the fresh-host Quickstart refuses existing installation state.
- Configuration metadata is descriptive and never changes operational settings.
  Retain a matching completed Harvest Seed and recoverable image payloads.
- See [release policy](docs/RELEASES.md), [Quickstart](docs/QUICKSTART.md) and
  [recovery](docs/RECOVERY_CONTRACT.md) for required inputs and rollback boundaries.
