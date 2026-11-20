# Release operations

`ReleaseService` owns accepted-candidate selection, recovery lineage, migration,
Runner and storage evidence checks, immutable controller/Wizard publication and
frozen release manifests. CLI and Nest providers can inject the same security
profile, lifecycle evidence policy and process port without running HTTP.
`gitlab/publish-successor.js` and `gitlab/publish-dockerhub.js` are compatibility
entry points to the compiled module. `ReleaseService.publishDockerHub` promotes
the same frozen accepted pair, verifies public anonymous manifests and preserves
immutable tags without rebuilding either image.
Build the operations package before using that entry point; it does not download
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

Run `npm run build` and `node --test tests/release.test.cjs` from `operations/`.
The repository's existing `tests/gitlab/publish-successor.js` also tests the thin
entry point, recovery lineage, failed publication and private credential cleanup.
`tests/gitlab/publish-dockerhub.js` covers immutable tags, interrupted retries,
classic/containerd identities and anonymous digest verification.
These are local synthetic checks; they do not publish images or establish that a
real platform migration passed.
