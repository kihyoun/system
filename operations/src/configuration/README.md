# Configuration import

`ConfigurationModule` exports `ConfigurationService` for ZIP Push. The retained
`system/push.sh` only holds the existing process-lifetime routing flock and maps
paths to the standalone Nest entry point. The service validates ZIP metadata
before extraction, checks the complete proposed alias set and optional impact
fingerprint, preserves the server-owned Wizard receipt and atomically replaces
main files without rewriting their contents. Routing-only changes call
`ProjectsRoutingService` directly and restore saved routing inputs after a failed
apply. The proxy service retains its own active-configuration rollback.

Push acquires the existing durable startup/storage barrier and Wizard environment
barrier before classifying or writing state. Completed failures release only their
own lease; uncertain subprocess completion or failed rollback retains the barrier
for deliberate recovery. The routing flock and environment barriers remain
compatible with native project setup. No new persistent lock format is introduced.

Run `node --test tests/persistence/persistence-push.test.js` after building
operations. `tests/sync/routing-push-api.js` exercises authenticated multipart Push,
impact review, routing decisions and rollback through the shared service with an
injected routing transport. These tests do not establish live proxy acceptance.

A restore caller that already owns both barriers may pass `SYSTEM_STORAGE_SPEC`
to the compatibility entry point. Reentrancy requires the exact active restore
helper/image identity in the existing storage owner record and the existing
environment barrier. The child neither removes nor replaces that parent's lease.
Missing, foreign or uncertain ownership is refused. The native storage restore
service continues to use its dedicated fresh-configuration import operation.
