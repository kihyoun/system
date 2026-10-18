# Managed Wizard build candidate

The build workflow enables checks and an immutable candidate registry artifact
after explicit preview/activation. It preserves the running Production Wizard;
Review/Beta deployment and Production promotion are separate operations. The
upstream Wizard CI and Dockerfile remain available alongside managed files.

New source imports use the source-appropriate versioned recipe. Vite snapshots
select the Node 24/Vite profile. Historical Node 13/CRA/Jest recipes remain
available only so existing reservations and evidence retain their exact hashes.
The controller runtime uses the supported Node 24 toolchain.

`recipe.js` returns a deterministic version/hash, managed CI and files under
`.system-bootstrapper/build-v1/`. The managed Dockerfiles use specific context
ignore files to exclude Git metadata, dotenv overrides and private material.
Modern checks run lint, Vitest, TypeScript/Vite build and configuration export.
The legacy profile supplies only the source importer's known-safe preflight
setting to CRA and sets `CI=true` for Jest. Independent browser checks verify
the rendered UI, Projects tab and nested SPA route, block external resources and save evidence.

Each CI job creates its own named, digest-pinned BuildKit builder and removes
that builder/cache and its own image references on exit. Candidate containers
and their internal network are separately named and removed. No global Docker
prune, daemon restart or platform service mutation belongs to these checks.
Hard termination can leave owned resources behind; inspect the exact job's
names before targeted recovery, never prune unrelated platform resources.

## Activation and recovery

The Sync module exposes preview, activation and status functions. The server
preserves the source-import receipt and stores a separate version-1 `build`
object. It requires the exact previewed recipe hash, completed managed source
registration and a configured local registry. Temporary GitLab API credentials
remain inside the existing Rails adapter and are revoked by its outer ensure.

The adapter checks repository ownership, source marker, default branch and
expected disabled scaffold. Recipe installation is one guarded `[skip ci]`
commit. It refuses occupied/edited files and checks the installed commit's
parent before starting any pipeline, including on interrupted retry.

Initial pipeline creation uses a session-scoped PostgreSQL advisory lock and
a durable non-secret project variable named
`SYSTEM_WIZARD_PIPELINE_<operation>`, scoped to `*`, containing the operation and
activation commit. Unrelated project variables are never changed. The intent
is created before sending the pipeline request. An uncertain response or a
process interruption after intent creation allows lookup only on retries.
No second blind pipeline POST is sent.

If the original pipeline appears later, refresh recovers its identity. If no
pipeline appears, the receipt reports `requires-reconciliation`. This includes
the deliberate crash window after recording intent but before sending POST.
An administrator must inspect the recorded operation, repository and pipeline
history before any explicit repair. Do not delete/reset the checkpoint merely
because a refresh returns no pipeline. Automatic retry is deliberately limited
to preserve the no-duplicate guarantee when an external outcome is uncertain.

Status refresh never installs files or creates a pipeline. A candidate is
verified only after the recorded pipeline SHA/ref/source and both required
non-optional jobs succeed, and their artifacts agree on source commit, pipeline
identity and the configured registry's exact SHA-256 digest. Browser and build
assertions must be present. Failed verification removes stale verified-artifact
claims while retaining operation/pipeline identities for investigation.

## Verification gates

Fixtures are `tests/gitlab/wizard-build.rb`, `tests/wizard/build-recipe.js` and
`tests/wizard/build-workflow.js`; the shared test manifest selects the isolated
checks. Fresh lockfile installation, actual selected-toolchain checks, candidate
HTTP/browser checks and real GitLab/runner/registry execution are separate
integration gates. Cached build dependencies and fixtures alone do not prove
the complete workflow. Retain matching source/pipeline/image evidence privately
and verify native job cleanup before promoting a candidate.

## Supported Wizard toolchain profile

The legacy `build-v1` recipe is retained byte-for-byte for its recorded hashes
and historical GitLab evidence. New source imports whose verified snapshot uses
Vite select the Node 24 / Vite 8 family (`node24-vite8-cleanup-v2` for new
reservations): Node 24.22.0/npm 11.19.1, locked install,
lint, Vitest, TypeScript/Vite build and Playwright 1.64.1 browser checks. Both
profiles use the same bounded job names and artifact/digest contract; modern
artifacts report `unitTests`, `testRunner: vitest`, `lint` and `typecheck` rather
than claiming Jest ran.

A reserved build always selects its exact known recipe hash. Unknown hashes are
rejected. Review/Beta reservations retain the matching build recipe hash and the
immutable helper checks that it still matches the canonical build reservation.
The modern profile therefore does not rewrite old GitLab recipes or silently
invalidate current deployment checkpoints. An existing imported project's
in-place source/toolchain upgrade still requires a separately reviewed migration;
a new snapshot import can use the supported profile directly.

## Exact default-tag cleanup

The recorded `legacy` and `node24-vite8` recipes remain byte-for-byte available
for their existing receipts and historical proofs. They have a known cleanup
limitation: an untagged browser image is recorded by Docker as `:latest`, and
that older cleanup comparison can leave its job tag behind while reporting
success.

New, unreserved builds use `legacy-cleanup-v2` or `node24-vite8-cleanup-v2`.
These profiles share the corrected cleanup implementation and otherwise retain
their original toolchain, build checks, browser checks and CI definition. The
cleanup adds `:latest` only when the final repository path component has no tag;
a registry port is preserved, and explicit tags and digest references are not
changed. Removal targets only that exact tag/reference, without pruning or
forcing image removal. Their distinct recipe hashes make the change explicit.

Installing this controller does not rewrite an existing canonical build or its
receipt. An already reserved recipe continues selecting its exact historical
hash. Use a matching controller/helper that recognizes both old and corrected
profiles. Move an active canonical project to a corrected profile through the
guarded [build/environment-only migration](../wizard-upgrade/README.md#build-and-environment-recipes-without-reimporting-source)
and verify native job cleanup. The migration must retain current source edits, the source import marker, stopped
environment floors and unrelated configuration. The full source-import
migration is not a shortcut for a cleanup-only change.
