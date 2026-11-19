# System Wizard

**You build it. You own it.**

System Wizard is the browser interface for
[System Bootstrapper](https://github.com/kihyoun/system). It manages platform
configuration, GitLab runners, application projects and deployment settings
through the Bootstrapper's authenticated Sync service.

The Wizard uses React 19, TypeScript 6, Vite 8, MobX and Material UI.
Use the Node/npm versions pinned in `package.json` and `.nvmrc` with the committed
lockfile. Application starters have their own generated build definitions.

## Use the Wizard with a Bootstrapper

Start with the [handbook](https://github.com/kihyoun/system/blob/master/docs/HANDBOOK.md)
for installation, first login, runner setup and troubleshooting. A standalone
Wizard development server does not start Sync, GitLab, the registry or runners.

The default **Overview** page introduces the platform. **Install System Bootstrapper** scrolls to its copyable **Quick Install** command for a fresh supported Ubuntu host; installation runs in the operator’s terminal. The three **How it works** cards and Docs links explain the next steps.
Select **Docs** in the top toolbar to read and search the integrated handbook,
including Quick Start, installation and configuration guides. Docs works without
a Sync connection; `/docs#docs/getting-started` opens its first chapter directly.
Select **Wizard** in the main navigation to configure an instance. `/configuration` remains a direct entry to the Wizard workspace.
Switching between Overview, Wizard, Docs and the footer's Privacy/Imprint views preserves the
current connection, configuration and in-progress form state in the browser.

The toolbar's **EN | DE | 한국어** switch selects English, German or Korean for the interface and
all handbook chapters. The preference is stored only in this browser; changing
it preserves the current configuration, connection and chapter. Commands,
configuration keys, file paths, code examples and operator-supplied information
are displayed unchanged. Docs uses the same collapsible application sidebar as
the Wizard, with a wider chapter list.

Application text uses stable, pinned `i18next` and `react-i18next` releases with
local translation resources. Material UI's built-in component text uses its
documented `deDE` / `enUS` / `koKR` theme locales. Translation lookup, interpolation and
plural selection stay in i18next; the original guide files remain the English
documentation source.

The original repository guides and GitHub READMEs remain English. German and
Korean reader translations live in `src/docs/locales/de/` and
`src/docs/locales/ko/`; each `sources.json` records the reviewed English
chapter hashes. After editing a guide, regenerate the English reader from the
System checkout, review both corresponding translations and update their
source hashes. Run `npm run docs:compile` to update both bundled locale catalogs.
`npm run docs:check` rejects missing or stale translations and changes to commands,
inline code, link destinations, heading structure or table structure. The normal
production build runs this check.

1. Open **Edit** using the pencil icon next to **Connect**. Enter the Sync server
   address and credentials from your own Bootstrapper configuration, then select **Submit**.
   For a fresh local setup, the address is `http://localhost/sync`; after applying
   the documented configuration, it is `http://sync.localhost`.
2. Select **Synchronize → Fetch** to load the instance's saved settings and projects.
3. Review changes, use **Backup** to save a local JSON copy, and use **Push** to
   apply platform configuration changes. A successful ZIP Push automatically restarts
   the Bootstrapper; wait for the interface to return and reconnect.

**Open/Backup** handle configuration files in the browser. **Push/Fetch** transfer
configuration to and from the connected instance. **Harvest/Seed** handle
persistent service data and certificates; they are not needed for an ordinary
configuration backup. The existing Seed action also transfers the form's main
configuration before restoring data, so review the form before invoking it.

A new configuration ZIP also includes `recovery.json` and `RECOVERY.md`, describing
saved and observed source/image identities and any missing recovery inputs. These
references do not preserve images or service data: retain accessible images and a
separate matching completed Seed. Older configuration backups remain importable.
See the [recovery contract](https://github.com/kihyoun/system/blob/master/docs/RECOVERY_CONTRACT.md)
before relying on recovery.

Configuration backups contain credentials and runner tokens. Keep them private.
Sync credentials are separate from the GitLab login. The controller logs confirm
that authentication is configured without printing its values. Follow the
handbook to read your effective credentials locally; saved configuration can
override the generated first-setup defaults.

### Public website and legal information

Use **Wizard → General → Website** to edit the public operator name, postal
address, contact email and optional privacy-notice URL, access-log retention and
additional privacy text. The initial name (`Max Mustermann`), address and contact
email (`kontakt@example.com`) are actual setup examples as well as input
placeholders. Replace or explicitly clear them; until then, published legal pages
label these examples. Optional fields stay empty unless supplied. An explicitly
saved empty value remains empty after Open, Fetch or recovery.

These settings travel through ordinary JSON/ZIP Backup, Open, Fetch and Push as
`WIZARD_OPERATOR_NAME`, `WIZARD_OPERATOR_ADDRESS`, `WIZARD_OPERATOR_EMAIL`,
`WIZARD_PRIVACY_NOTICE_URL`, `WIZARD_ACCESS_LOG_RETENTION` and `WIZARD_PRIVACY_TEXT`
in the main configuration. They are public information, separate from Sync
credentials and runner tokens. A successful Push applies the saved configuration
and publishes the supported fields through the Bootstrapper's normal startup.

The footer's **Privacy** and **Imprint** pages read only `/privacy-instance.json`
from the same website, when opened. The matching Bootstrapper generates this
allowlisted public file on persistent storage and mounts its directory read-only
at `/usr/share/nginx/wizard-public`; it never serves the full configuration.
Use compatible Wizard and Bootstrapper versions for this publishing workflow.
A standalone Wizard without that mount shows the generic missing-information
message. No operator identity, retention period or legal compliance is inferred.

Runner count controls independent managers sharing the configured GitLab runner
registration. Open the runner's detail page in GitLab to see its managers. Manager
system IDs have separate persistent directories; ordinary container recreation
reuses them. An offline manager entry can represent retained capacity from an
earlier pool size and does not by itself require deregistration.

### First-setup suggestions

If no main configuration exists, Fetch requests derived suggestions from the
updated Sync API instead. Existing NGINX routes take precedence over suggestions
based on the connection hostname. Both components must support
`GET /config/suggestions`; an older server does not provide this fallback.

Suggested fields carry an asterisk and a tooltip asking you to verify their
values before pushing. Unknown values, passwords and runner tokens remain empty.
No suggestions are pushed automatically, and they do not configure DNS or prove
that certificates exist. Saved server configuration always takes priority.
Loading saved settings clears the derived markers; JSON Backup/Open preserves
markers already present in the local configuration.

## Create an application project

Connect to Sync, Fetch the configuration, then select **Projects → Add Project**.
Choose a GitLab namespace and enter a nonempty Project Key containing only
lowercase ASCII letters and digits. The key determines the exact repository name
and path; environment domains are independent settings. Existing stored keys are
not renamed.

Choose an **Application template**:

| Template | Generated files |
| --- | --- |
| React + TypeScript + Vite | React source, Vite build settings, pinned dependencies and lockfile, Dockerfile and managed CI |
| Angular + TypeScript | Angular source, CLI build settings, pinned dependencies and lockfile, Dockerfile and managed CI |
| General web project | HTML, CSS and JavaScript, NGINX runtime, Dockerfile and managed CI; no Node build |
| Empty repository | README and managed CI; add your own application source and Dockerfile later |

Configure enabled **Production**, **Beta** and **Review Apps** environments,
including their HTTP/HTTPS and automatic/manual deployment settings. **Save**
creates a private repository through Sync. Availability checks distinguish an
occupied destination from a failed lookup; existing repositories are not adopted
or overwritten. Setup runs asynchronously and reports progress while the browser
polls with short requests.

For the three application starters, Sync installs the source and matching CI,
configures routing, then starts the first pipeline. The pipeline builds and
publishes the image, checks its HTTP response and deploys automatic environments.
Start manual deployment jobs in GitLab yourself. The empty option waits for a
root Dockerfile before running the application workflow.

Expand the project row to open its repository and pipeline links. Wait for the
build and deployment jobs to succeed before checking an application domain;
repository creation alone does not confirm a running application. Generated
source, Dockerfile and CI remain editable. Each starter includes a
GETTING_STARTED.md with local development commands. React and Angular starters
use their own pinned Node 24 toolchain.

Repeated Save resumes the same operation instead of creating duplicate projects
or initial pipelines. Repository and template metadata survive Fetch and JSON
Backup/Open. See the
[project guide](https://github.com/kihyoun/system/blob/master/docs/PROJECT_BOOTSTRAP_GUIDE.md)
for error recovery and deployment details. Ordinary edits to an existing
project's environments retain the configuration/Push workflow; they do not
rename its repository or rewrite committed CI automatically. Optional per-environment
exact host aliases redirect HTTP and HTTPS to the existing canonical host,
preserving the path and query and allowing ACME HTTP-01. Provision a certificate
covering the canonical host and aliases. Push reviews its expected service impact:
existing application routing edits use a proxy reload while GitLab remains
available; wider changes require a platform restart. Fetch, JSON/ZIP Backup/Open
and Push retain alias settings and environment ownership.

### The default Wizard project

Configured Bootstrapper startup automatically registers
**wizard** as the first project. Fetch after setup completes to load it. Its
Production URL is the real system-interface address from General; the existing
Wizard keeps running at that address. The entry is managed under General, so
project edit/delete controls and environment switches are disabled.

A newly registered managed repository starts with a README/CI registration
scaffold. Automatic registration does not import Wizard source, start a pipeline
or replace the UI. An operator can instead explicitly adopt an existing private
Wizard source project using the source-primary workflow below; this keeps source,
reviews, builds and image delivery in the same repository.

Expand the Wizard row and select **Initialize
Wizard source**. The preview identifies the private repository, pinned source
revision and file count. **Import source** explicitly installs that revision;
opening the preview alone changes nothing. The original scaffold README stays
in place; the source README is stored separately. Conflicting repository files
are never overwritten. Retry the action after a reported interruption to
recover the same source import.

The source-import action imports source only: managed CI remains disabled, no pipeline is
started, and Production, Beta and Review deployments are unchanged. See the
[source initialization guide](https://github.com/kihyoun/system/blob/master/docs/WIZARD_SOURCE.md)
for prerequisites, state and recovery. The separate build action is described below.
Registration is idempotent and survives Fetch, Backup/Open, Push and restart.
Conflicting local keys or foreign repositories are reported without overwriting
them. Review/Beta environments and Production promotion have separate controls;
source import alone does not enable them.

### Build and verify the imported Wizard

Expand the managed Wizard row and select
**Build and verify Wizard**. Its preview identifies the owned repository,
imported source commit and recipe version. **Enable build pipeline** explicitly
installs the managed build recipe and starts or recovers its initial pipeline.
Opening the preview alone does not activate anything. **Refresh status** updates
the recorded pipeline and required checks. A verified candidate image appears
only after the controller validates the required job and artifact evidence.

For a pending, installed or temporarily unverifiable operation, review
**Refresh preview** before using **Resume activation**. A status refresh or
failed request invalidates the previous preview confirmation. The server still
enforces ownership, expected content and durable pipeline identity.

An uncertain pipeline-creation outcome offers refresh and administrator
inspection only. Do not clear its checkpoint or start another activation to
work around it. Failed verification hides previous artifact claims until
verification succeeds again. Source initialization is separate from this build
operation; after enabling CI, use the build/status action rather than repeating
source import.

The managed build recipe selects a toolchain profile for the imported source;
the Vite source uses the Node 24/Vite profile. Build verification alone does not
promote Production. Review/Beta require explicit environment configuration, and
Production uses the guarded operator plan/apply/rollback workflow. See the
[managed build guide](https://github.com/kihyoun/system/blob/master/docs/WIZARD_BUILD.md),
[environment guide](https://github.com/kihyoun/system/blob/master/project-bootstrap/wizard-environments/README.md)
and [Production guide](https://github.com/kihyoun/system/blob/master/project-bootstrap/wizard-production/README.md).

## Local development

Use Node 24.22.0 and npm 11.19.1 (`.nvmrc`, `engines` and `packageManager`).
Install the exact dependency graph and start the Vite development server:

```bash
npm ci
npm start
```

Vite serves development at `http://localhost:5173`. Connect to an explicitly
chosen Bootstrapper Sync endpoint to exercise authenticated operations. Use the committed dependency versions and configuration when reproducing builds.

Run the checks and build the production SPA into the existing `build/` directory:

```bash
npm run lint
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:ci
```

Vitest covers configuration and workflow regressions. Playwright checks the
rendered interface, navigation, backup download and SPA fallback. Set
`WIZARD_BASE_URL` to check an already running isolated candidate instead of
starting the local preview server.

## Container and publishing workflow

The Dockerfile uses the same Node/npm versions and locked installation, checks
lint/tests/types, and serves the built SPA through NGINX on port 80. Updating
source does not replace the running image. Keep the last verified immutable
image for recovery and validate separate candidates before Production rollout.

The legacy publishing CI preserves its distinct Review, Production, Docker Hub,
GitHub mirror and platform-update roles. Public domains and publishing credentials
remain operator configuration. The source-primary workflow below builds and
checks images in the canonical project without invoking legacy upstream
publishing credentials.

### GitLab source-primary workflow

A clean source repository can explicitly select `.gitlab/primary.yml` in its
GitLab **CI/CD configuration file** setting. This runs lint, unit tests,
TypeScript/Vite build and signed configuration-export checks, then Playwright
against that exact build artifact in a disposable loopback preview. The existing
`.gitlab-ci.yml` publishing jobs remain available independently. With image
delivery disabled, the source-primary pipeline needs only its ordinary Node/browser
runner. It never deploys Production or updates System's Wizard gitlink automatically.

Source-primary jobs and the managed image/browser builds install the committed
[Mozilla CA bundle](.system-bootstrapper/build-v1/ca/cacert-2026-10-20.crt)
using the versioned `node24-vite8-ca-v4` recipe. Its image-only refresh verifies
the bundle checksum and removes obsolete OpenSSL certificate hash links before
installing the reviewed trust store. Node uses that store through
`NODE_OPTIONS=--use-openssl-ca`. The source browser job repeats the refresh after
Playwright installs operating-system dependencies, which can recreate old trust
links. Run the refresh only inside disposable CI/build images, never on the host OS.

Its opt-in `deploy:github` job forwards the exact successful protected default-
branch push commit to one configured existing GitHub branch, after both required
checks. Set `GITHUB_BACKUP_ENABLED=true`, `GITHUB_BACKUP_SOURCE_PROJECT`,
`GITHUB_BACKUP_REMOTE` and `GITHUB_BACKUP_BRANCH` as reviewed protected variables.
Supply the write-enabled repository deploy key as protected file variable
`GITHUB_SSH_PRIVATE_KEY` (an existing multiline key is also supported) and verified
GitHub host keys as protected file variable `GITHUB_SSH_KNOWN_HOSTS`. Host keys
must be verified independently; jobs never discover or trust them with keyscan.
Failures remain visible and retryable. The job forwards no tags, side branches
or deletions and never force-pushes or rewrites `origin`.

Unit/model, browser and image checks run independently of optional mirror
success. Verify successful `build:source` and `test:browser` jobs for the exact
merged commit. A mirror failure remains visible and retryable; it never authorizes
Production promotion or changes the active image.

### Build and deliver from the same project

Use one private GitLab project as the canonical Wizard repository for source,
issues, merge requests, tests and container images. No second copy of the source
repository is required. The optional GitHub mirror forwards the same reviewed
history; it is not a separate delivery input.

Select `.gitlab/primary.yml` as the project's CI configuration path and enable its
container registry. Source and mirror jobs select a runner with both `docker` and
`wizard-source-primary` tags. Image jobs use the `docker` tag and need an explicitly
trusted Docker executor with access to the host Docker socket. That access can
control the host; use a runner dedicated to trusted project code.

Set the non-secret project variable `WIZARD_DELIVERY_ENABLED=true` to add
`build:wizard` and `test:wizard` to ordinary merge-request and default-branch push
pipelines. With the variable absent or different, only the existing source checks
and optional mirror run. Keep the successful-pipeline merge requirement enabled.
There is no extra API-triggered or branch-only delivery pipeline.

`build:wizard` checks the locked source in a pinned Node/Vite build, publishes an
immutable registry digest and records its source commit and pipeline identity in
`build-evidence.json`. `test:wizard` starts that exact image and a Playwright
browser in an internal disposable Docker network, checks navigation and the
configuration ZIP/Cube signature, and saves `wizard-evidence.json` and browser
artifacts. Each job records its own bounded cleanup in `cleanup.json`; no global
Docker prune or platform restart belongs to these jobs. The GitHub mirror waits
for these checks when delivery is enabled.

An administrator must explicitly bind this project to a compatible Bootstrapper
as a source-primary managed Wizard; selecting a CI file alone does not transfer
ownership or authorize deployment. After Fetch, the managed project row offers
**Wizard source** and **Native build status**. These read the canonical repository
and native pipeline evidence; legacy source import and build activation are
unavailable for an adopted project. Production promotion remains a deliberate
plan/apply operation using evidence from the exact successful default-branch push
pipeline, its immutable image digest and the retained rollback checkpoint. A merge
or image build does not replace the running Wizard.

Review and Beta remain optional manual jobs. Configure
`SYSTEM_WIZARD_ENVIRONMENT_IMAGE` with the provisioned immutable helper image ID,
`SYSTEM_WIZARD_ENVIRONMENT_OPERATION` with its recorded operation identity, and
`WIZARD_REVIEW_HOST` / `WIZARD_BETA_HOST` with the explicitly reserved HTTPS hosts.
The controller independently verifies those values against its canonical project
receipt; CI variables alone cannot grant ownership. Same-project merge-request
pipelines offer `deploy:review` / `stop:review`; default-branch push pipelines offer
`deploy:beta` / `stop:beta`. Candidate jobs remain absent until their opt-in settings
are present. They preserve the ordinary Production interface and never promote it. See the
[Production guide](https://github.com/kihyoun/system/blob/master/project-bootstrap/wizard-production/README.md)
for independent verification and promotion.

Project documentation is maintained in English. See [AGENTS.md](AGENTS.md) for
the immutable System Cube signature, which must remain unchanged in generated and imported configuration.

## Community

See [contribution guidance](CONTRIBUTING.md), the [code of conduct](CODE_OF_CONDUCT.md),
[security reporting](SECURITY.md) and the [MIT license](LICENSE). Dependency updates
follow the [approval-controlled operations guide](https://github.com/kihyoun/system/blob/master/docs/DEPENDENCY_UPDATES.md).
