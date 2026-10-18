# Supported System runtime base

Build the base with the existing standalone build context:

```sh
docker build -t system-runtime:candidate ./bootstrapper
```

The complete System image also runs `bootstrapper/install-runtime.sh` from its
repository build context. It starts from the same official digest-pinned Node
24.22.0 / Alpine 3.24 image instead of requiring a separately published System
base. The shared installer checks Node 24.22.0 and npm 11.19.1 before installing
the pinned Docker CLI 29.8.2, Compose 5.1.4, Buildx 0.34.1 and the existing shell utilities.
Both `docker-compose` and `docker compose` remain available. Custom `IMAGE`
overrides must satisfy the same runtime checks.

The image digest pins the upstream filesystem; explicit APK package versions
pin direct tools. Alpine repositories still resolve transitive package updates,
so these inputs alone are not a full offline package snapshot. If an APK pin
becomes unavailable, the build fails rather than silently selecting another
version. Refresh the digest, Node/npm assertions and direct package versions
together in a reviewed change, then rebuild and validate the complete candidate.

Do not replace libraries inside the historical Alpine 3.16 image or copy glibc
Node binaries into it. The supported base is a complete candidate replacement.
Building it does not restart the running platform or alter its Docker daemon.
The Docker client communicates with the existing daemon only when explicitly
given access to it; a version check does not prove deployment compatibility.

Before promotion, validate Compose configuration and startup contract tests,
build/lint/API/signature regressions and the integrated Wizard source packaging.
Live restart/recovery acceptance and manual Production promotion remain separate
coordinated actions. Preserve the previous working image and private settings.

Tracking: [supported base refresh](https://github.com/kihyoun/system/issues/27)
and [Sync migration](https://github.com/kihyoun/system/issues/23).
