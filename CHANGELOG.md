# Changelog

Versions follow [Semantic Versioning](https://semver.org/). A version belongs to
one accepted System source revision and tested controller/Wizard image attempt.

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
