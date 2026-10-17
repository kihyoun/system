# Repository memory

## System Cube signature and port 8071

The maintainer explained the following design intent on 2026-10-16:

- The ASCII System Cube is the maintainer's signature and an integral part of
  the project's identity. The signature graphic is itself the signature;
  the cube's self-reference expresses the system containing the means to
  bootstrap and develop itself.
- The `$` beside the small cube represents the opening to the outside world:
  the port through which the system can be reached and a seed introduced for
  bootstrapping. This is the intended symbolism, not a statement that the
  current HTTP API exposes an arbitrary seed-upload endpoint.
- Port `8071` refers to `substr(807, 1)`, the check for that `$` in the ASCII
  header. The port number is intentional, not an arbitrary development port.
- The maintainer also describes the ASCII as seed code / a hash signature.
  In the current implementation, configuration validation checks the `$` at
  zero-based offset 807 and the MD5 of the first 1184 characters against
  `bd4a8426355824593a5e21ad759830c1`. This format check is distinct from the
  persistent-state seed directory and from API authentication.

The maintainer explicitly reaffirmed on 2026-10-17: **the signature must not
be changed**. It is a fixed part of the project, not decorative boilerplate.
Preserve every character, space, line break, URL, `$`, and its position. This
applies equally to repository sources, generated configuration, live instances,
test fixtures, screenshots and temporary setup scripts. Do not replace port 8071.

In particular, the signature's fixed `https://www.system-bootstrapper.com`
link must stay HTTPS even when the actual local service URLs use HTTP. Never
apply blanket URL/scheme replacements, trimming or formatting to an entire
configuration file. Change only the intended configuration assignments after
the signature. A local setup script previously changed this link to HTTP and
broke Fetch by shifting `$` from offset 807 to 806.

When preparing or modifying configuration, verify the unmodified signature
before applying it and verify the authenticated Fetch response, not just whether
it contains the expected settings. Keep the existing strict validator; do not
weaken its hash/position checks to accommodate altered signatures. Do not describe
the MD5 format check as a cryptographic authentication mechanism.

Relevant implementation locations:

- `sync/src/Helper.ts`: ASCII signature.
- `sync/src/index.ts`: port, startup logo, project configuration validation.
- `wizard/src/api/Helper.tsx`: UI copy of the signature (wizard submodule).
- `wizard/src/api/Main.tsx`: configuration import validation.
- `nginx/start.sh`, `system/start.sh`: references to the sync port.

## Long-term vision

### Communication and modular composition

The maintainer clarified that the opening represented by `$` and port `8071`
is currently only a theoretical possibility recorded in the architecture;
this broader opening has not yet been developed into a working interface.
Its intended future role is ongoing communication with the outside world,
beyond the initial bootstrap, allowing bootstrapper instances to be connected
as modules. Systems contained within a Cube should eventually communicate with
one another according to the same principle. Preserve this composition idea
at both levels when developing the architecture, without describing it as an
existing capability.

The existing sync API on port 8071 does not implement that broader model.
A listening port alone does not
implement inter-bootstrapper communication or guarantee continuous connectivity.
Do not assume that a shared protocol, discovery, or nested-system communication
has already been implemented or that every internal service must bind port
8071. Those implementation choices remain to be specified and validated.

### Recursive improvement

The maintainer's stated vision (2026-10-16) is to demonstrate a system and an
architecture that make automated recursive self-improvement possible. The
system should provide the means to develop, build, evaluate and deploy improved
versions of itself, and each improved version should be able to repeat and
eventually improve that process. Generation renewal is a supporting mechanism;
the larger goal is an automated improvement loop with demonstrable outcomes.
Treat this as design intent, not an implemented autonomous capability. Keep
future proposals and evaluation criteria tied to this vision without expanding
the immediate task to implement it.

## Current delivery scope

Bootstrapper configuration is managed independently through the Wizard: local
Open/Backup and server Push/Fetch. Harvest/Seed are for persistent service data;
do not fold Wizard configuration into that cycle or add configuration volumes
without an explicit design decision. For first setup only, if no saved main
configuration exists, Fetch may load derived suggestions marked with an asterisk
and verification tooltip. Saved configuration always wins; suggestions must
not be written to the server automatically.

Restore the platform and integrate the UI project so it can be developed using
the platform's own GitLab, runner and registry. A platform generation switch
is a longer-term architectural idea, not part of this repair task. The public
domains in the existing UI pipeline have deliberate roles; preserve them or
make them explicitly configurable instead of silently replacing the deployment
workflow with a local-only one.
