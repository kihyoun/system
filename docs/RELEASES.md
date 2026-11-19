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

Publication never upgrades an existing installation. Quickstart remains the
fresh-install path; rerunning it or pulling Git is not an upgrade. The Wizard
Docs release chapter provides manual installed-version and target-version
selectors without Sync. Selection is informational and runs no command.

The initial declared transition is **1.1.3 → 1.2.0**, for an unmodified official
controller/Wizard pair on Ubuntu 24.04 / 26.04 x86_64. It changes those two images
and the retained release selection. Core containers can also be recreated when
the target applies updated Compose policies, including log limits. GitLab, databases, runners, NGINX,
application projects, domains and storage selections remain selected. The target
must publish matching transition evidence before CLI preflight accepts it.
Unknown releases, changed image/source identities, private Wizard substitutions,
downgrades and undeclared service/database transitions fail before maintenance.
No required database stop is implied by compatible product version numbers.

1. Obtain the selected target release source and its exact Wizard gitlink. Keep
   the old checkout and recovery inputs separately available. Use the version
   whose public metadata and publisher you deliberately trust.

```bash
git clone https://github.com/kihyoun/system.git system-upgrade
cd system-upgrade
git checkout --detach v1.2.0
git submodule update --init --recursive
```

2. Reserve a maintenance window and wait for running jobs, pending platform
   operations and GitLab background migrations to finish. Avoid repository or
   account changes between plan and acceptance: read-only operational samples
   compare up to ten existing projects/repository heads, users, issues, merge
   requests and registry records. These samples complement preserved mount,
   image and configuration checks; they do not enumerate every user record.
   The host requires at least 8 GiB RAM and 8 GiB additional free space on both
   live recovery storage and Docker storage. Native Harvest separately checks
   the explicitly selected backup filesystem, UUID and required capacity.

3. Attach that backup medium and select a new configuration ZIP filename on it.
   Replace every example path below with your own. Use the existing private
   storage selector and a mode-0600 API-token file for **your installation**, with
   permission to read its runners and managers. No publisher GitLab account,
   API token or private artifact access is needed. The plan fetches and verifies
   the public target pair before dependent maintenance, validates current source
   and image identities, checks routes, authenticated Fetch, idle operations,
   migration prerequisites and runner contacts, and prints impact and recovery.

```bash
sudo python3 bootstrapper/upgrade-release.py \
  --target 1.2.0 \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0 \
  --backup-file /mnt/backup/configuration-before-1.2.0.zip \
  --token-file /root/system-api-token
```

A failed read-only preflight remains inspectable through status. After correcting
its prerequisites, repeat planning in the same directory only when status says
failed and no reviewed plan or updater checkpoint exists. If a lost process left
a checking attempt, retain that directory and select a new plan directory. Native
lease checks still refuse active or unfinished operations; do not delete leases.

4. Review the complete plan and its SHA-256. Replace `PLAN_SHA256` with the
   exact printed hash; apply refuses a missing or different confirmation. It
   rechecks the publication and retained configuration, performs the existing
   coordinated backup, and verifies the exact configuration ZIP against its
   completed Seed generation and manifest. Missing media fails explicitly;
   there is no backup fallback directory on the system disk. Both backup inputs
   must remain independently accessible. Prior controller/Wizard image payloads,
   public provenance, selection files and native update checkpoints are retained
   beneath the selected live recovery directory before the paired update starts.

```bash
sudo python3 bootstrapper/upgrade-release.py --operation apply \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0 \
  --token-file /root/system-api-token \
  --confirm-plan PLAN_SHA256
```

5. The cold matching backup pauses GitLab and later resumes it; the paired
   update restarts controller/Sync and Wizard; core proxies can also be recreated
   when target Compose policies change. Existing jobs must finish first.
   Duration depends on data and host performance; there is no fixed downtime
   promise. The existing updater owns live-state leases and rollback checkpoints.
   Completion requires saved configuration and authenticated Fetch equality,
   expected service/mount identities, management routes, registry authentication,
   fresh runner-manager contacts and matching read-only data samples. The private
   operation records the exact accepted version/source; retain all verification
   and recovery inputs until you accept the result. Consumers do not run the
   development platform test suite on their installation.

6. After interruption, inspect status before taking further action. A backup
   that failed before the controller updater started must be inspected through
   the retained coordinated-backup operation; resolve its native status and
   leases before creating a new plan. When an updater checkpoint exists, recover
   verifies and loads the retained prior image payloads and invokes the existing
   paired rollback, including its owned interrupted-lease recovery. Never delete
   active leases or run an old database image against migrated data.

```bash
sudo python3 bootstrapper/upgrade-release.py --operation status \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0
sudo python3 bootstrapper/upgrade-release.py --operation recover \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0 \
  --token-file /root/system-api-token \
  --confirm-plan PLAN_SHA256
```

Docker archives preserve image IDs but may lose registry digest selectors.
Recovery therefore saves verified `system-bootstrapper-recovery:…` aliases in
`BOOTSTRAPPER_IMAGE` and `WIZARD_IMAGE`, with a private image-ID receipt. This
also lets the previous controller start offline after reloading its saved
configuration. All other configuration bytes remain unchanged. The original
configuration and release selectors stay in the controller checkpoint; status
reports that original configuration path and the deliberate recovery selector
mode. Before another official upgrade, pull the original controller and Wizard
digest references from that checkpoint, verify their recorded image IDs, and
restore those two selectors through the normal configuration workflow. Do not
replace any other current setting or delete the retained recovery inputs.

The current public graph contains only controller/Wizard transitions. A
container rollback cannot reverse a database migration. Future declared service
transitions must use the existing [GitLab migration and cold-checkpoint recovery](HANDBOOK.md#5-evolving-a-running-system)
procedure with its required intermediate versions and independently retained
recovery inputs; the public CLI rejects unimplemented transition kinds. Full
[configuration and Seed recovery](RECOVERY_CONTRACT.md) remains the fresh-storage
recovery path. A graph path with intermediate releases is shown in order; apply
requires the first intermediate release's own checkout, new backup and separately
confirmed plan, then repeats for the next stop. It never jumps to the final tag.

Unchanged official source builds without a release-selection receipt and modified
forks use the existing accepted-successor workflow: merge upstream, resolve
conflicts, build and test their own successor, and deliberately promote it with
its native evidence. Public official-release evidence cannot authorize local
modifications or infer a missing source identity.

The public manifest binds `system-upgrade-vX.Y.Z.json` by SHA-256. That
allowlisted provenance includes the exact source/image identities, successful
same-attempt required jobs, original evidence hash, storage/migration proof and
tested transition. Raw logs, private registry addresses and configuration are
excluded. Trust comes from the explicitly selected publisher repository over
HTTPS and its reviewed publication workflow. Hashes establish a consistent
publication; a checksum alongside its payload is not an independent signature.
No consumer check disables the publisher's native merge or acceptance gates.

Maintain `bootstrapper/upgrade-paths.json` with each supported release. Add only
explicitly exercised ascending edges, prerequisites, ordered steps and the named
candidate stage; preserve mandatory intermediate releases. The CLI and offline
Wizard bundle use this same metadata. Export the Docs bundle, review English,
German and Korean content, run metadata/UI and failure/recovery checks, then run
the existing candidate's targeted previous-public-release transition. Previous
images are obtained from their public metadata, not maintainer-owned pins. The
publisher refuses an edge without matching passed runtime transition evidence;
changing metadata does not manufacture compatibility.
