# Configuration and Seed recovery corrections (#43)

Issue: https://github.com/kihyoun/system/issues/43

The clean-host recovery exposed three independent backup boundaries. Configuration
remains a separate Wizard export; service data remains a Harvest Seed; installation
source is fetched afresh. Runners and their working directories are regenerated.

1. Parse literal shell assignments without evaluation, preserving single/double
   quotes, escaped metacharacters, equals signs, numeric fields and unknown runtime
   options. Preserve project identity receipts and the exact Cube signature. Reject
   unsupported shell expansion explicitly rather than exporting corrupted values.
2. Add model-level regression tests exercising Fetch/import, JSON re-open and ZIP
   export. Verify values with an actual shell and keep credentials out of logs.
3. Make Harvest produce a staged, completion-marked Seed while GitLab is cleanly
   stopped; resume it on success/failure. Preserve the previous Seed if copying
   fails. Include indispensable Certbot renewal state separately from configuration.
4. Validate a completed Seed before restore, reject running GitLab and retain a
   retry marker after interrupted restore. Update host certificate integration so
   renewal paths can be rebound on another volume.
5. Document the source/image version contract and remaining full clean-host/CI
   acceptance. Component regressions do not replace the full restoration test.

All implementation and tests use isolated checkouts and fixtures. Production,
existing Seed trees and historical backups are untouched.

Follow-up: retain an exported private, immutable Wizard image pin on a clean host.
Start GitLab and a GitLab/registry-only proxy, mint an owned-project
`read_registry` deploy token through restored GitLab, pull the exact digest using
a new temporary Docker configuration, then revoke the token and remove the login.
Check receipt/project identity before minting, persist interrupted-cleanup state,
and cover success/failure revocation plus the early routing boundary. Prove the
complete path with a real CI-published derivative image absent from the fresh
daemon's declared source-build archives; do not replace the saved image pin.
