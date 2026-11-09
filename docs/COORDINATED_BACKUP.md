# Coordinated Seed and configuration backup

Choose **Coordinated backup** in the authenticated Wizard and deliberately start
**Back up Seed and configuration**. The workflow validates the selected backup
filesystem, mount identity and available space through the native Harvest
entry point before stopping services. Missing or incorrect media is an error;
it never creates a replacement backup directory on the system disk. Normal
operation continues to use the independently selected live storage.

## Two recovery inputs

The completed Seed remains on the selected external medium under
`SEED_DIR/snapshots/<generation>`. Its `current` link selects the latest completed
snapshot. The Wizard offers the ordinary `bootstrapper.zip` configuration backup
as a separate authenticated download. It contains settings and secrets; store it
securely and independently of the server being backed up. A temporary server
copy is provided for download retry and is never the only copy to rely on.
The server retains completed download files under its private configuration
state directory until the operator deliberately removes those files. Do not
remove active operations or their leases to reclaim space.

The normal versioned recovery metadata in `bootstrapper.json` and `recovery.json`
records the exact Seed generation, manifest SHA-256, native completion time,
GitLab image identity, configuration capture time and SHA-256 of every captured
ENV file. Compare these with the retained Seed manifest and ZIP entries before
recovery. The ZIP download also has its own displayed SHA-256. No configuration
secrets or configuration payload are added to the Seed manifest.

## Progress and failures

The global storage lease and configuration helper lease prevent concurrent
configuration changes during capture, Harvest and export. The certificate lease
also spans capture and Harvest. The ZIP reuses the normal Wizard model and ZIP
exporter and preserves the exact captured main and project ENV bytes. It never
exports unsaved browser edits. Native Harvest still performs its required cold
backup verification and resumes GitLab on completion or handled failure.
No pipeline or automatic restore rehearsal is started.

Refresh status to follow preflight, capture, Harvest and ZIP export. Closing the
dialog does not cancel the native helper. The latest operation can be reopened
in the same browser session. After a browser download, confirm that the ZIP was
saved safely; initiating a download alone cannot prove that the browser stored it.
The pair is complete only when both independent recovery inputs are retained.

A Harvest failure preserves the previous completed Seed. If a new Seed completed
but export failed, the result is partial and identifies that new generation;
there is no claim that an older ZIP matches it. Resolve the error and repeat the
workflow. A failed browser download can be retried against the retained ZIP.
If helper completion or service resumption is uncertain, inspect the native
operation and remaining leases before retrying. Never remove an active lease,
promote staging directories or describe an unconfirmed operation as complete.

Detach the backup medium only after the native helper has completed and GitLab
has resumed. An interrupted or uncertain operation requires inspection first.
Historical snapshots are retained; retention and deletion remain explicit.

## Compatibility and recovery

Ordinary configuration Open, Backup, Push and Fetch and standalone Harvest and
restore keep their existing behavior. Old backups without pair metadata remain
usable with the existing manual matching procedure. Opening a paired JSON backup
retains historical metadata as unverified evidence and drops its asserted Seed
match; editing or re-exporting it does not make a fresh backup pair.

Follow the [recovery contract](RECOVERY_CONTRACT.md) with a matching completed
Seed, configuration ZIP, compatible recovery tools and freshly fetched source.
A matching checksum establishes association and integrity, not an automatic
restore authorization or proof that image payloads are independently available.
