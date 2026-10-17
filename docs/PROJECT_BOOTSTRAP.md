# Project bootstrap

## Current delivery: register the System Wizard automatically

Tracked in [the automatic Wizard registration issue](https://github.com/kihyoun/system/issues/19).

The maintainer revised the scope on 2026-10-17: when the configured platform
starts with the Wizard enabled, register it automatically as the first project.
Its Production URL must come from the real main Wizard configuration, including
its HTTP/HTTPS mode and certificate settings. The running interface remains the
same service. Do not create a second proxy for its address or replace the UI.

Use the existing authenticated project provisioning infrastructure to create
the private `root/wizard` repository scaffold and retain its identity across
Fetch, Backup/Open, Push and restart. Repeated startup must reuse it. Existing
local keys or unrelated repositories must be reported without overwriting them.
Beta and Review are deliberately disabled in this delivery. This registration
is an initial part of the feedback loop, not a working self-update mechanism.

## Next expansion

New requirements are tracked in GitHub issues. Wizard source import, local
build/test, Review/Beta and controlled Production rollout are tracked in
[the Wizard feedback-loop issue](https://github.com/kihyoun/system/issues/18).
The remaining sections preserve earlier requirements as background; automatic
registration supersedes their optional-project wording for this delivery only.

## Intended workflow

The Wizard should manage an application as one project, including its GitLab
repository, generated CI configuration, environments and NGINX routing. Creating
a project should not require a second manual repository setup or copying CI YAML
into GitLab. The general Add Project flow is implemented;
see the [operating guide](PROJECT_BOOTSTRAP_GUIDE.md). Wizard source import and
its separate review deployment remain an optional subsequent delivery.

## Application templates

Agreed with the maintainer on 2026-10-17: extend Add Project with a choice of
**Angular**, **React**, or a **general web project**. This branch implements template generation on top of the merged general bootstrap.

For Angular and React, selecting a template should create a complete, small,
working application: source, dependencies, framework-specific build settings,
Dockerfile, runtime configuration and matching GitLab CI. The user should not
need to write a Dockerfile or manually assemble the initial build pipeline.
The generated files remain editable in the repository so the user can start
coding immediately after creation.

The first pipeline should build the generated application using the existing
runner/registry and deploy it to the enabled environments according to the
selected automatic/manual deployment settings. Verify a reachable application,
not just repository creation or successful CI YAML validation. Preserve the
strict key/collision contract, asynchronous status, recovery behavior and the
immutable Cube signature from the general bootstrap delivery.

The general web-project option starts with framework-free HTML, CSS and JavaScript, served by NGINX without a Node build. Users can edit its Dockerfile for a custom toolchain. Angular and React use pinned manifests, lockfiles and Node 24 build images, independently of the existing Wizard toolchain.

The previous general-bootstrap and signature PRs were merged with explicit maintainer approval. Template changes are a separate delivery. Importing the existing Wizard remains an optional infrastructure use case.

## Bootstrap foundation and optional Wizard demonstration

First implement the general **Add Project → Save** workflow: configure an
application, create its GitLab repository and install its generated CI without
manual copying. This foundation comes before automatically suggesting or
bootstrapping the Wizard project.

After that foundation works, the first infrastructure demonstration will be
**System Wizard itself**. Import its
existing source into the platform's GitLab, build it using the shared instance
runner pool, and expose a separately reviewable version before replacing the
running configuration UI. This makes the UI a concrete participant in the
platform's feedback cycle. It does not implement autonomous self-improvement or
a platform generation switch.

Managing the Wizard as an application is an **optional development use case**.
It is our first demonstration project, not a project automatically added to
every bootstrapper instance. Users who only manage their own web applications
can use the supplied Wizard without importing its repository, creating its
pipeline or managing its deployment as a project.

## One project creation flow

1. Choose a project key and the target GitLab namespace through **Add Project**.
   Show the destination repository before creating anything.
2. Configure the application's enabled Production, Beta and Review environments,
   their domains and HTTP/HTTPS settings. Additional project runners remain
   optional; the existing instance runner pool is sufficient for this first app.
3. **Save** sends the complete project configuration to the bootstrapper. It
   creates the GitLab project/repository and records its identity with the
   configuration. An existing destination must be reported rather than silently
   overwritten or assigned an automatically suffixed name.
4. Generate and install the CI configuration for those settings. Preserve the
   upstream pipeline and its deliberate public domains; a separate managed CI
   path is preferable for the locally imported project. Account for the actual
   default branch and the Wizard's existing build/runtime requirements.
5. Apply the project networks and NGINX routing, start the pipeline, and show links
   to the repository, pipeline and enabled application environments.
6. Build and test a separate Wizard deployment. Promotion to the configuration UI
   remains an explicit operation so a failed build does not remove the working UI.

## Repository naming contract

The repository display name and path are exactly the **Project Key**. For example,
key `mywebapp` creates `<selected-namespace>/mywebapp`. New keys must be nonempty
and contain only lowercase ASCII letters `a-z` and digits `0-9` (`^[a-z0-9]+$`).
No spaces, umlauts, punctuation, hyphens or other special characters are allowed.
Lowercase also fits the derived Docker Compose project names. Validate this
same rule in the input field and on the backend before checking availability or
creating anything. Explain invalid input rather than silently removing characters
or lowercasing the user's key. Existing stored keys are not renamed by this new
creation rule. GitLab-specific reserved names and API constraints still need to
be reported if GitLab rejects an otherwise syntactically valid key.

Production URL, Beta URL and Review App domains are independent settings and do not determine the
repository name. A later domain change must not rename the repository.

Collision handling must distinguish a successful retry of the same operation
from an unrelated existing repository. Never overwrite an existing project or
create an automatically suffixed name as an implicit fallback. Renaming a
configured key must not
silently rename or replace a GitLab repository.

### Background availability check

After a short input pause, check the entered Project Key against the GitLab API
in the selected namespace. The browser calls the authenticated bootstrapper Sync
service; GitLab administration credentials never enter the browser. Check the
complete namespace/repository path, not just the display name or a global search.
Also reject duplicate keys already present in the current Wizard configuration.

Show checking, available, already exists and could not verify states beside the
field. An existing repository is a blocking error for creating a new project.
An API failure or authorization error must not be interpreted as availability.
Ignore stale responses when the user changes the key or namespace while a check
is running.

The background check is advisory: revalidate on Save and handle GitLab's actual
create response as authoritative. Two users may choose the same key between
validation and creation. Report that conflict without overwriting, silently
linking or automatically renaming a repository.

There is no UUID requirement. Retrying a successful Save must recognize the
same project operation rather than create another repository; choose the
implementation without changing the user-visible Project Key/repository name.

## Backend responsibilities

Repository creation and CI installation belong in the authenticated Sync service,
not in browser-side GitLab admin requests. Use the bootstrapper's existing access
to its own GitLab container. Any temporary GitLab credential must be scoped to
the required operations, revoked on completion/failure and excluded from logs,
Wizard state and configuration exports. Runner-creation scope alone is not enough
for repository management; determine the supported project API permissions.

Import/build operations need asynchronous status reporting, actionable failures
and retry behavior that avoids duplicate repositories or overwriting user code.
Do not stop GitLab as part of provisioning its own project. Configuration remains
independent of the Harvest/Seed cycle and continues to support Fetch and Backup.

Domains, certificates and deployment routing must describe the same environments
as the generated pipeline. Reuse the existing HTTP and supplied-certificate
settings. Let's Encrypt issuance and renewal must be verified separately with
real domain/DNS control; the local HTTP test does not demonstrate issuance.

## Acceptance for the first delivery

- Create the Wizard project through one UI flow with no manual CI copy/paste.
- The repository and pipeline URLs refer to the connected GitLab instance.
- The generated configuration survives Fetch and a JSON Backup/Open round-trip.
- The shared runner builds/tests the imported Wizard and publishes its image.
- A review deployment is reachable through its configured local domain.
- A failed import, build or deployment leaves the existing Wizard available.
- Repeating or retrying does not create duplicate projects or erase source files.
- Background key checks are namespace-aware and discard stale responses.
- New keys satisfy the same lowercase alphanumeric rule in the UI and backend.
- Invalid keys never trigger repository creation and receive a clear field error.
- A duplicate detected during Save is reported even if the earlier check passed.
- GitLab lookup failures are shown as unknown availability, never as a free name.
- No temporary GitLab administration credential reaches the UI or JSON export.
