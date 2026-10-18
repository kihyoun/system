# Managed Wizard image cleanup correction

The managed browser job builds an untagged local reference. Docker records it
with `:latest`, while both recorded cleanup recipes compare the listed tag with
the untagged input. The job can therefore report successful cleanup without
removing its own browser image. This correction is part of
[System #21](https://github.com/kihyoun/system/issues/21) and the managed delivery
work in [System #18](https://github.com/kihyoun/system/issues/18).

1. Preserve all existing legacy and Node 24 recipe bytes and recipe hashes.
   Previously reserved builds, environment receipts and migration proofs must
   remain verifiable against their exact historical recipes.
2. Add one shared cleanup revision that normalizes an absent tag to `:latest`
   only after considering the final repository path component. Preserve
   explicit tags, registry ports and immutable digest references.
3. Expose corrected legacy and Node 24 profiles for new build reservations.
   Continue selecting old reservations by their exact recorded hash. Require
   the existing reviewed migration to change an installed canonical recipe;
   adopt the exact recipe hash reserved by that migration checkpoint.
4. Exercise the generated corrected scripts with a Docker CLI mock whose
   image listing reproduces Docker's implicit default tag. Check exact owned
   tag removal, unrelated-tag preservation, digest handling, bounded failures
   and primary exit preservation. Run relevant recipe, environment and
   migration component checks without a live Docker workload.

The current canonical project already uses the historical Node 24 recipe and
has a later source edit on main. Corrected profile generation alone does not
fix its jobs. Its explicit transition must guard the current head and old
managed build/environment proofs, install only the corrected managed build
files/marker and matching environment CI/helper/marker, and adopt after native
green jobs and reviewed merge. It must not reimport or overwrite source. This
operator transition is implemented separately from this normalization change.
