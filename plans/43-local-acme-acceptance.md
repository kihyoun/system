# Local ACME renewal acceptance for recovery (#43)

Issue: https://github.com/kihyoun/system/issues/43

Keep this phase separate from the frozen recovery baseline and the private Wizard
pin scenario. No public ACME request, Production port or Production state is used.

1. Declare exact pinned public Pebble, Pebble DNS-test-server and Certbot inputs.
   Commit only the public test trust certificate extracted from the pinned Pebble
   image, with its SHA-256 and provenance. Trust it only in fixture clients.
2. Create an independently owned internal bridge, configuration volume, CA and
   DNS containers. Reuse the existing candidate ownership journal/checkpoint and
   cleanup guards for each owner. Keep CA/DNS memory below 512 MiB in total;
   create no additional GitLab daemon. Share the current candidate's deadline and
   cancellation, and preserve the CA account database across both DinD lifecycles.
3. Attach each owned candidate daemon to that private bridge. The DNS fixture
   answers the test service names with the current daemon's private address.
   Pebble performs actual HTTP-01 requests against that daemon's real NGINX port
   80. Disable authorization reuse, never validation. Publish no host port.
4. Before Harvest, issue a real test certificate with Certbot's webroot plugin
   into the candidate's declared persistent Certbot directory. Configure the real
   Wizard/Sync TLS paths and export the real Wizard configuration ZIP. Record
   only account identity and public certificate hashes as verification oracles.
5. Remove the original DinD host and restore only the ZIP and marked Seed to the
   different new data root. Rebind renewal paths using the real source helper.
   Prove the account identity is unchanged. A negative DNS target must prevent
   renewal; restoring the new daemon's address must permit actual renewal with
   a new certificate serial. Verify deployed HTTPS with the fixture issuance CA.
   Exercise the fresh-source certificate installation/reload hook where its real
   mount and utility prerequisites can be met in the isolated host fixture.
6. Journal and remove only owned fixture containers/networks/volumes. Cleanup
   works after cancellation and timeouts, refuses foreign or ambiguously owned
   resources, and retains recovery receipts when cleanup fails. The acceptance
   flag remains false until a real end-to-end run passes.

First implement bounded offline contracts for image/trust identity, command and
network isolation, ownership/durability ordering, cancellation, negative validation
and cleanup. Root and the runtime agent review lifecycle hooks before activation.

Primary references:

- https://github.com/letsencrypt/pebble (volatile authority state and local trust)
- https://github.com/letsencrypt/pebble/tree/main/cmd/pebble-challtestsrv
- https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates
