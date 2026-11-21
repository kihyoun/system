# Release operations

`ReleaseService` owns accepted-candidate selection, recovery lineage, migration,
Runner and storage evidence checks, immutable controller/Wizard publication and
frozen release manifests. CLI and Nest providers can inject the same security
profile, lifecycle evidence policy and process port without running HTTP.
`system-bootstrapper release successor` and `system-bootstrapper release dockerhub` are thin CLI
entry points to the compiled module. `ReleaseService.publishDockerHub` promotes
the same frozen accepted pair, verifies public anonymous manifests and preserves
immutable tags without rebuilding either image.
Build the root backend package before using that entry point; it does not download
or compile dependencies during publication or recovery.

The lifecycle policy is required. Historical receipts use the historical guided
preview validator. A new product lifecycle must provide its own verified policy;
missing evidence is never accepted by default. Stage results retain their original
host and CI identities across cold recovery. Only allowlisted lineage fields are
copied into publication artifacts; registry credentials live outside artifacts
and are removed on success or failure.

`readSourceIdentity` interprets existing `system-successor-release-v1` metadata
without a `sourceLayout` as a separate Wizard commit (`wizardRevision`). New
monorepo releases keep that release format and explicitly set
`sourceLayout: system-monorepo-v1`, `sourceRevision` to the System commit and
`wizardSourceTree` to the tracked Wizard tree object. Both image revision labels
identify the System commit. Mixed, missing and unknown layouts are rejected.
`readSuccessorRelease` binds those source identities, both image identities and
exact frozen evidence bytes to one accepted pipeline attempt. Historical source
identity is never inferred from the current checkout.

`publicSource` applies the same discriminator to GitHub release metadata. New
`system-accepted-release-v1` assets carry `source.sourceLayout` and
`source.wizardSourceTree`; `source.revision` remains the System commit. Historical
assets retain `source.wizardRevision` and `source.wizardRepository`. Monorepo
publication verifies the public System commit/tree, requires no separate Wizard
repository receipt, and keeps all native pipeline acceptance gates. Public
upgrade provenance retains the same layout and Wizard tree in its release record.

Run `npm run build` and `node --test tests/operations/release.test.cjs` from the repository root.
The repository's existing `tests/gitlab/publish-successor.js` also tests the thin
entry point, recovery lineage, failed publication and private credential cleanup.
`tests/gitlab/publish-dockerhub.js` covers immutable tags, interrupted retries,
classic/containerd identities and anonymous digest verification.
These are local synthetic checks; they do not publish images or establish that a
real platform migration passed.

`ReleaseModule.registerNpm` exports the injectable `NpmPublicationService` for
standalone Nest callers. Its process, HTTP and GitLab evidence ports are explicit;
imports do not run commands. `system-bootstrapper release package-cli` and `system-bootstrapper release npm`
open and reliably close that context. The package entry point returns a Promise.
Preparation requires a clean tracked checkout at the native CI commit, matching
package/VERSION identity and positive safe pipeline/job identifiers. It packs the
already built runtime with lifecycle scripts disabled and records its exact
SHA-256/SHA-512 bytes. The native package job remains responsible for building and
testing that runtime before packaging; publication never rebuilds it.

Publication requires the existing protected default-branch acceptance gates plus
successful same-attempt package and GitHub release jobs. It compares all local
inputs against those jobs' artifacts before contacting npm. New monorepo GitHub
releases also require the package test; historical Gitlink releases retain their
existing gates. The npm registry is fixed to `https://registry.npmjs.org/`.
Publication uses a private temporary copy of the verified tarball and credential
file, excludes inherited npm configuration and unrelated secrets from the child
environment, disables package scripts, and removes temporary credentials on all
exit paths. Existing versions and interrupted retries succeed only when the public
name, version and integrity match exactly; conflicting versions are never replaced.
`node tests/gitlab/npm-publication.js` exercises these paths with injected ports
and no network or live publication. The public CI entry points require the built
operations runtime and configured protected publisher credentials.


`ReleaseModule.registerGithub` exports `GithubPublicationService`. The service
uses typed acceptance, public-metadata, upgrade-provenance and immutable-release
presentation policies, with injected HTTP, process and accepted-image evidence
ports. The former GitHub and public-upgrade scripts are compatibility adapters.
Same-attempt native GitLab jobs and their exact artifact bytes must pass before
any GitHub tag or draft is created. Draft retries retain existing immutable
assets; published releases cannot acquire replacement assets. Anonymous readback
verifies the exact source, public image digests and every release asset. The HTTP
adapter bounds response streams and strips credentials before following an
allowlisted signed asset redirect. `tests/gitlab/publish-github-release.js` and
`tests/gitlab/public-upgrade-release.js` exercise both historical and monorepo
publication, interrupted drafts, privacy allowlists and native verifier roundtrips.
