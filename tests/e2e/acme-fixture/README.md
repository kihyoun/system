# Test-only ACME trust

`pebble.minica.pem` is the public test TLS CA shipped in the official Pebble image
`ghcr.io/letsencrypt/pebble@sha256:ddf230642b1a584f519f32e347de1b05a6e4c1f6c35c1863b33effeab5f78199`.
It was extracted from `test/certs/pebble.minica.pem` in its Linux/amd64 OCI layer
`sha256:b69492b104cfe1bab09501bd6de44043b61159bd3df60073617acc36522c9e11`, after
checking the layer digest. The certificate's SHA-256 is
`0c502e52627ff7de972c7e9e065640103b4589b4e2d23d3fcf21bef1e3c8c67c`.

Trust this certificate only in the isolated fixture's HTTPS clients. Never add it
to a host, Production container, browser or general-purpose trust store. Pebble's
test CA private key is intentionally public upstream; this trust has no role in
the platform's ordinary HTTPS configuration. The authority's separately generated
issuance root is fetched over this authenticated test channel for fixture TLS
verification only.

Source and rationale: https://github.com/letsencrypt/pebble#avoiding-client-https-errors
