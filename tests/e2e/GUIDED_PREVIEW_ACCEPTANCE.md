# Shared System Beta acceptance

The disposable platform scenario uses the existing System candidate, its native
`wizard/` tree and the exact prepared helper/Wizard images. A private Git bundle
preserves the real commit; import verifies commit and tree identities before
pushing with `ci.skip` into the existing owned test project. No separate Wizard
repository, source build, Review lifecycle or duplicate full System CI is added.
Ordinary application Review/Beta acceptance remains part of the platform suite.

Evidence version 2 explicitly declares
`acceptanceScope: native-lifecycle-with-contract-verifier` and
`verifier.mode: contract-fixture`. Native shared setup, binding, owned Docker
Beta deploy/stop, image labels, exact-host TLS, unchanged Production and cleanup
are verified on the disposable platform. Pipeline authorization is covered by
the shared native verifier's positive and negative contracts. The
parent candidate has not yet completed, and is never represented as a completed
native authorization pipeline. Fixture identities occupy an explicit namespace;
publication strips unrecognized fields and rejects missing or contradictory
facts. Historical version 1 receipts retain their original validator.

The test-only helper subclass lives in the harness. Production launchers have
no environment switch or other path to select its verifier. On failures, the
harness still attempts the exact owned Beta stop, checks container/network/helper
removal and released leases, revokes its named temporary credential and verifies
Production. Uncertain cleanup cannot produce passing evidence. Recovery omits
the Wizard archive in the new daemon, so the exact private registry pin must be
pulled with a temporary project deploy token rather than satisfied from cache.
The canonical stopped-generation receipt survives recovery; deploying again
requires an explicit valid System Beta binding.

## Operator preflight

`guided-preview-live.js` accepts only `--check-only` with a private JSON input:

```json
{
  "version": 2,
  "syncUrl": "https://sync.example.com",
  "gitlabUrl": "https://gitlab.example.com",
  "controllerImageId": "sha256:<64 independently verified hex characters>",
  "settings": {
    "version": 2,
    "namespace": "operator-team",
    "wizard": {"mode": "existing", "project": "system"},
    "review": {"enabled": false},
    "beta": {
      "enabled": true,
      "host": "beta.example.com",
      "ssl": "/ssl/live/beta.example.com/fullchain.pem",
      "sslKey": "/ssl/live/beta.example.com/privkey.pem"
    }
  },
  "reportPath": "/root/private-beta-preflight/report.json",
  "timeBudgetMilliseconds": 3600000
}
```

Keep the input mode 0600 outside the checkout. Run on the operator's Linux host
with Node 24 and access to the local Docker socket:

```sh
node tests/e2e/guided-preview-live.js --check-only /root/private-beta-preflight/input.json
```

The plan checks retained installation identity and native prerequisites. It does
not apply setup, bind a candidate or deploy an environment; `--apply` is rejected.
Native preflight may create and revoke its usual temporary API credential. A
successful plan has `acceptancePassed: false`. The disposable contract fixture
is never selected for a user installation. Neither this preflight nor offline
contract tests can replace a completed native disposable platform run.
