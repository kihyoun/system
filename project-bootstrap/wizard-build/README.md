# Managed Wizard build candidate

This is Phase B of the Wizard delivery workflow, tracked in System issue 33
under issue 18. It enables checks and a candidate registry artifact after an
explicit preview/activation. It does not deploy Production, Beta or Review.
The existing public Wizard CI and Dockerfile are preserved.

The recipe deliberately uses the existing Node 13.12 / CRA / React baseline
with its committed lockfile, Jest suite and production build. That runtime is
obsolete and the legacy dependency graph is not claimed to be security-clean.
Modernization is tracked separately in System issue 22. The controller remains
on the supported Node 24 runtime.

`recipe.js` returns a deterministic version/hash, managed CI and files under
`.system-bootstrapper/build-v1/`. The managed Dockerfiles use specific context
ignore files to exclude Git metadata, dotenv overrides and private material.
Only the source importer's known-safe preflight setting is supplied to CRA.
The Jest command deliberately sets `CI=true`; the production build retains the
baseline warning policy. Independent browser checks verify the rendered UI,
Projects tab and nested SPA route, block external resources and save evidence.

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

Fixtures are `tests/gitlab/wizard-build.rb` and
`tests/wizard/build-recipe.js`, `tests/wizard/build-workflow.js`. The coordinator
owns HTTP/UI integration and registering these in the shared test runner.
Fresh lockfile installation, the actual legacy Jest/production build, candidate
HTTP/browser checks and real platform GitLab/runner/registry execution are
separate required gates. Cached build dependencies and fixtures alone do not
prove the complete workflow. Record each gate's actual result in issue 33;
keep parent issue 18 open until Review/manual promotion/recovery are delivered.
