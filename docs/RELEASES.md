# Accepted product releases

System uses **MAJOR.MINOR.PATCH**, tagged `vX.Y.Z`, following
[Semantic Versioning](https://semver.org/): incompatible public configuration,
backup, API or installation contracts require a major version; compatible
features use a minor version; compatible fixes/security fixes use a patch version.
A database migration can need downtime and a checkpoint even when its operator
contract remains compatible. Release notes must declare migration and recovery
requirements; SemVer alone does not prove an arbitrary upgrade safe.

**1.0.0 is the initial supported product baseline.** Historical commits and image
publications retain their original identities. `VERSION` and the
[maintained changelog](https://github.com/kihyoun/system/blob/master/CHANGELOG.md)
are reviewed with each intended release. Failed candidates, retries and ordinary
pipeline executions do not acquire new versions. If a source/image attempt already
owns a version, a different accepted attempt requires a new reviewed version.

## Public release contents

[GitHub Releases](https://github.com/kihyoun/system/releases) present the result of
the trusted GitLab workflow. The public code mirror and Docker Hub remain the
source and image distribution paths. GitHub Actions is not part of publication.
Each stable release provides:

- A create-only GitHub presentation tag pointing at the exact mirrored accepted
  System commit, plus user-facing notes from the reviewed changelog.
- `system-release-vX.Y.Z.json` and its SHA-256 sidecar: the exact System commit,
  source tree and Wizard gitlink; matching public controller/Wizard references,
  immutable manifest/config digests and accepted image IDs; same-attempt evidence
  hash and tested host compatibility; installation/upgrade/recovery links.
- `quickstart.sh`, bound to that release tag, and `release-notes.md`.

The public manifest format is `system-accepted-release-v1`. All data is generated
from the accepted same-pipeline candidate, Docker Hub publication and exact Wizard
source-publication receipts. Raw internal receipts, private registry URLs,
configuration, Seeds, credentials and operating logs are not release assets.
Metadata and checksum are both obtained from the trusted GitHub release; their
checksum detects inconsistent transfer, not an independent signing identity.

Example retrieval for an explicitly selected version:

```bash
curl -fLO https://github.com/kihyoun/system/releases/download/v1.0.0/system-release-v1.0.0.json
curl -fLO https://github.com/kihyoun/system/releases/download/v1.0.0/system-release-v1.0.0.json.sha256
sha256sum -c system-release-v1.0.0.json.sha256
```

Check out the manifest's `source.revision` and initialize its pinned submodule:

```bash
git clone https://github.com/kihyoun/system.git
cd system
git checkout --detach v1.0.0
git submodule update --init --recursive
git rev-parse HEAD HEAD^{tree}
git ls-tree HEAD wizard
```

Compare these outputs with the manifest. GitHub's plain source archives omit
Wizard submodule contents; they are not a complete recursive checkout. Retained
Wizard release refs make the pinned gitlink publicly retrievable without changing
the Wizard default branch.

Install a fresh host using [Quickstart](QUICKSTART.md), or pass the manifest's
`images.controller.reference` and `images.wizard.reference` to
`bootstrapper/install-release.py --controller ... --wizard ... --release-metadata ...`.
The native installer verifies exact source and pulled image identity. References
alone do not preserve image payloads: retain verified image archives or make sure
public/private registries remain recoverable for the required recovery period.

## Trusted publication and retry behavior

The required component, browser, candidate image and disposable platform checks,
reviewed merge, post-merge checks, public image copy and source mirror remain in
GitLab. The protected native default-branch `deploy:github-release` job runs after
those jobs; it verifies their exact pipeline/source/artifact ownership through the
GitLab API and anonymously checks public source and image availability. It copies
no images and performs no rebuild. Any existing GitLab version-tag pipeline gates
remain unchanged. The GitHub-only presentation tag creates no GitLab tag pipeline.

The publisher uses a serialized resource group. It creates a draft, uploads
consistent assets, publishes it, and verifies anonymous retrieval. A retry reuses
only a tag at the identical commit, identical release fields and byte-identical
assets; it refuses reassignment or replacement. Interrupted drafts can be completed
by retrying the same attempt. A published version cannot gain missing/replacement
assets. Enable GitHub immutable releases and registry immutable discovery tags as
additional server-side protection against writers outside this workflow.

Configure these protected variables on trusted GitLab runners:

- `GITHUB_RELEASE_PUBLISH_ENABLED=true`, plus the existing Docker Hub, GitHub
  backup and Wizard-source publication enable flags and credentials.
- `GITHUB_RELEASE_REPOSITORY=kihyoun/system` (or the operator's public mirror).
- `GITHUB_RELEASE_TOKEN_FILE`: external mode-0600 file containing a scoped GitHub
  token with Contents write access to only the release repository. A protected
  masked `GITHUB_RELEASE_TOKEN` is the fallback. File selection has precedence.
- `SYSTEM_RELEASE_GITLAB_TOKEN_FILE`: external mode-0600 scoped GitLab `read_api`
  token for the source project; protected masked `SYSTEM_RELEASE_GITLAB_TOKEN`
  is the fallback. SSH mirror credentials cannot publish through the release API.

Keep both tokens unavailable to untrusted MR code and outside the checkout and
artifact paths. Missing credentials fail closed. No existing mirror SSH key is
assumed to be a usable API token. Public metadata never embeds these credentials.

## Upgrade and rollback

Publication is presentation and distribution; it does not promote Production.
An existing operator uses the accepted source/image inputs with the native
[controller promotion](../bootstrapper/README.md),
[GitLab migration and cold-checkpoint recovery](HANDBOOK.md#5-evolving-a-running-system)
and [configuration plus Seed recovery](RECOVERY_CONTRACT.md) workflows.
Keep the prior controller/image, configuration, matching Seed or cold checkpoint,
source and independently accessible credentials. A container rollback cannot
reverse a database migration. Review each release's declared compatibility and
run the prescribed verification before deliberate promotion.
