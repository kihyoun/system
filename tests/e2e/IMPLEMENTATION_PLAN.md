# Complete the platform CI candidate

Tracking: [System #21](https://github.com/kihyoun/system/issues/21) and
[System #23](https://github.com/kihyoun/system/issues/23). This follow-up completes
existing PRs 28, 29, 30 and 38 without changing the Production checkout.

1. Repair the committed isolated build-context allowlist after the persistent
   storage integration; test every newly required Dockerfile input.
2. Package a separate committed-only full-System build context, materializing
   only validated pinned Wizard files; exclude Git metadata and private state.
3. Build and compile the complete supported-runtime System candidate in CI,
   and retain its exact image identity as acceptance evidence.
4. Update the private DinD lifecycle for explicit persistent configuration,
   runner and service paths. All paths belong to the owned disposable daemon;
   no existing host data or credentials are inputs.
5. Extend bounded acceptance beyond HTTP smoke: readiness, registration and
   provisioning idempotency, disposable CI/registry image behavior, and the
   seed cycle. Obtain the coordinator resource lease before real GitLab startup.
6. Connect required CI gates and sanitized JSON/JUnit artifacts. Exercise a real
   GitLab MR pipeline and deliberate failure before claiming completion.

Offline transport fixtures establish contracts, not live GitLab acceptance.
Production rollout, GitLab-primary cutover and code-review merges are separate.
