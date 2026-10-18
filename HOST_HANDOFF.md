# Host handoff - 2026-10-18

## Resume here

Read `AGENTS.md`, this snapshot and [System issue #34](https://github.com/kihyoun/system/issues/34).
The next task is to make the platform-owned GitLab primary and GitHub its backup.
The maintainer selected that task, then explicitly paused implementation to
prepare this handoff for a new chat. No cutover, GitHub backup push, new API
credential or synchronization activation was performed during that preflight.
Resume implementation when the new chat requests it.

Use current GitHub `master`, not the old `codex/host-handoff-20261018` branch.
Baseline immediately before this documentation-only update:
System `d9cfdf42ea46a0d57263f2fe22a5f4903b7aaaf4`, tree
`61da97d36c86fec5c240c354e5677b690410052b`; Wizard gitlink
`6588a2104d682a9a33192f64f8f0b8921fcfeb23`. The running runtime code was merged
in System PR #38 as `ba36026682f3aed45b288ff517b2f45b69ba0ac7`.
Later handoff documentation commits do not change that runtime validation.

```bash
git clone --recurse-submodules https://github.com/kihyoun/system.git
cd system
# Read AGENTS.md and HOST_HANDOFF.md, then inspect the linked issue and live state.
```

## Current platform and access

| Machine | Address | Purpose |
| --- | --- | --- |
| Platform | `2.31.62.101` | GitLab, registry, Wizard, controller and runner; 8 CPUs/32 GB RAM |
| Codex VM | `159.69.212.100` | This session's root-owned Codex client; approximately 4 GB RAM |

Production UI: https://system-bootstrapper.com ; GitLab:
https://gitlab.system-bootstrapper.com ; registry:
https://registry.system-bootstrapper.com ; Sync:
https://sync.system-bootstrapper.com . Both hosts are Ubuntu 26.04.1.

On the existing Codex VM, the platform SSH identity selector is
`/home/codex/.ssh/id_ed25519_codex_20261018`; do not copy its contents into Git.
Verified platform host fingerprint:
`SHA256:4zV00K0CoXYEjsbsMUjYIjw/Sq0uX7yyUPkuVrSHebw`.
Existing platform checkout: `/opt/system` ->
`/mnt/HC_Volume_24222125/platform/source`, clean at the baseline above.

The small Codex VM now accepts SSH public-key authentication only, including
root; port22 remains open. UFW allows incoming22/tcp for IPv4/IPv6, otherwise
blocks unsolicited inbound traffic and permits outbound traffic. The maintainer
confirmed a new key login works and explicitly wants Codex's root privileges
preserved. APT update/upgrade completed and automatic security updates are enabled.
`open-vm-tools` remains deferred by Ubuntu phasing. A reboot for installed kernel
7.0.0-38 is still pending; running kernel was 7.0.0-30. No reboot was authorized or
performed during this session. Local receipt:
`/root/coordination/root-vm-hardening-20261018.json` on the Codex VM.

The old dedicated GitLab API tokens30/31/32 were revoked and each verified401.
Their private JSON records under platform-host `/root/coordination/private/`
remain for audit but cannot authenticate. Do not reuse them or print credentials.
If API access is needed, provision a new owned, scoped, expiring credential through
an authorized mechanism, keep it private and revoke it after the operation.
No GitHub write credential readiness was established in the cutover preflight.

## Running state and completed backlog

Fourteen GitHub PRs were merged: System #28/#29/#30/#31/#32/#35/#36/#37/#38/#40/#42
and Wizard #12/#13/#14. System issues #18/#21/#22/#23/#24/#26/#43 are completed;
only #34 remained open. There were no open GitHub PRs at final verification.

- Controller and prospective environment-helper image:
  `sha256:16474e4858527294414a87b80e3a4874761fb85d796d611864aaca5334aa8a58`.
  It is the clean, validated pipeline45 artifact; no runtime docker commit was used.
- Production Wizard stays on accepted pipeline44/source
  `b43c52d952af04e2ebe10a9273c024da2b55a965`, registry reference
  `registry.system-bootstrapper.com/root/wizard@sha256:8d16ec3e3d97be0600a1233b99146bbee27f4cd015308c5824efa3300edf7f9d`.
  Promotion, deliberate rollback and re-promotion passed. Subsequent build-only
  cleanup changes were not promoted as a new application version.
- Canonical private GitLab project1 is `root/wizard`, default branch `main` at
  `cdd5c07b8a6bdc97d6704e4d116dba57a0640f4c`. MR4 upgraded only managed build/
  environment definitions. App/import-marker bytes, modes and last-change history,
  source gitlink revision6588 and original import2cb21135 were preserved.
- Canonical merge policy is restored to `merge`. Review and Beta are stopped,
  without pending/retired leases; their generation floors/tombstones remain43/44.
  Do not reset them or treat intentionally stopped endpoints as failed deployment.
- Wizard migration is complete: React19.3.1, Vite8.3.4, TypeScript6.0.3,
  Node24.22.0/npm11.19.1. Existing docs for registration-only or legacy Node13
  describe earlier delivery stages; current evidence below supersedes that status.
- Diagnostic project2 `root/coordination-runtime-ci-20261018` and project3
  `root/wizard-modernization-review-20261018` are retained evidence projects.
  Their diagnostic MRs are closed without merging; branches/artifacts preserved.
  Do not silently turn these into the canonical System development repository.
- Historical and corrected Wizard browser-job image tags were reconciled; final
  global `wizard-check-*` tag count was zero. No global Docker prune was used.

## Persistence and evidence

The retained volume is `/dev/sdb`, direct ext4, mounted at
`/mnt/HC_Volume_24222125`, UUID `07e22857-8272-430d-bd3f-8fcd02c6d9ca`.
Online resize2fs completed after expansion to25 GiB; final usage was about7.9 GB,
with16 GB free. All persistent service-data volumes/binds resolve to that UUID.
`PERSISTENT_DIR` is the volume's `platform/` directory. Preserve `seed/`, `backup/`
and live `platform/` data. The retained Seed predates later GitLab workflow changes;
do not assume it is a current matching snapshot of the latest configuration ZIP.

Host mount settings are in `/etc/system-bootstrapper/persistence.env`.
Private configuration is in `platform/configuration/`, with main `.docker.env`,
project `.projects.env/.wizard.env` and `sync-auth.env`. These are secret-bearing
runtime files, not repository inputs. Configuration export remains separate from
Harvest/Seed. Source code is freshly checked out when rebuilding.

Verified evidence (all dates2026-10-18):

- [Full required pipeline45](https://gitlab.system-bootstrapper.com/root/coordination-runtime-ci-20261018/-/pipelines/45):
  all12 jobs and53 maintained checks passed. Real config ZIP/cold Harvest,
  original-host removal, second-host backup-only restore, private Wizard recovery,
  restored database/registry/runner state, actual registry CI/failure gating,
  old registry-blob execution and real ACME renewal passed. All five cleanup
  receipts passed and owned containers/networks/volumes were zero.
- [Wizard MR4](https://gitlab.system-bootstrapper.com/root/wizard/-/merge_requests/4),
  [MR pipeline50](https://gitlab.system-bootstrapper.com/root/wizard/-/pipelines/50)
  and [main pipeline51](https://gitlab.system-bootstrapper.com/root/wizard/-/pipelines/51):
  corrected browser tags153/157 were observed during execution and then removed
  natively, independently of cleanup.json. Historical recipe hashes remain valid.
- Actual final Production Chromium Connect/Fetch/UI ZIP download passed, including
  Cube signature, runner1/project1 and all runtime extension literals. Multiple
  WIZARD_IMAGE override lines correctly resolved to the final Production digest.
- Full passing resource measurements were recorded for pipeline35. Only one
  12 GiB/4 CPU heavy lifecycle was qualified on the32 GB host; concurrent heavy
  candidates remain unqualified. Optional Review/Beta helper reprovisioning on a
  completely fresh OS is an explicit operator step, not part of the core backup-only proof.

On the volume, inspect `platform/recovery/evidence/acceptance-pipeline45.json`,
`resource-measurements-through-35.tar.gz` in that evidence directory, and
`platform/recovery/wizard-build-cleanup-acceptance-20261018/`. The last directory
contains sanitized evidence and the latest PRIVATE configuration `bootstrapper.zip`
(70706 bytes, SHA256 `15a502c7b2f0c4bd39adaf7b192273945b6a63400997b807ab48436cc6e9c3d3`).
Controller/Production rollback checkpoints are also under `platform/recovery/`.
`/opt/coordination/runtime-ci-retained-image.json` on the platform host binds
validated image164 to source9191/treeacabb/public0fd and pipeline45/job148.

## Next task: issue34 cutover

1. Inventory real GitLab repositories, refs, protected variables and permissions.
   Preserve the running platform. Establish the canonical System repository and
   central issue home deliberately; inspect only secret names/readiness, never
   dump values. Do not assume a GitHub CI push key exists or can write both repos.
2. Reconcile histories and record source/target branch mappings first. Managed
   Wizard main contains imported source and local managed commits; it must not be
   force-pushed over GitHub master. Decide a history-preserving integration or an
   explicitly mapped backup branch. Preserve tags and the System Wizard gitlink.
3. Reuse `gitlab/github-backup.sh` and `github-backup-transport.js` with protected
   CI credentials. Their offline failure/retry/divergence tests passed; live backup
   activation has not. The selected managed Wizard workflow is
   `.system-bootstrapper/ci.yml`; changing only upstream `.gitlab-ci.yml` will not
   activate it. Serialize backup jobs, preserve strict host verification, expose
   failures and prevent backup/deployment loops or automatic Production promotion.
4. Move/redirect the remaining central issue with cross-links and retain historical
   issue/PR references. Update agent instructions, remotes and operating docs when
   the actual source-of-truth switch occurs, not before.
5. Prove the complete flow: central GitLab issue -> MR -> required green checks ->
   merge -> GitHub backup at the same resulting commit, with failure/retry,
   concurrency/divergence recovery and repository plus GitLab metadata restore
   evidence. Close issue34 only after its acceptance criteria are fulfilled.

Production stays manual. Keep the Cube unchanged, keep every persistent path on
its volume, preserve source edits and avoid unrelated history rewrites.
