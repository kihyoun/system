# Project bootstrap

## Intended workflow

The Wizard should manage an application as one project, including its GitLab
repository, generated CI configuration, environments and NGINX routing. Creating
a project should not require a second manual repository setup or copying CI YAML
into GitLab. This is the next functional extension, not behavior implemented by
the current label changes.

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
key `my-webapp` creates `<selected-namespace>/my-webapp`. Validate the key before
Save; do not silently transform it into a different slug. Production URL, Beta
URL and Review App domains are independent settings and do not determine the
repository name. A later domain change must not rename the repository.

Collision handling must distinguish a successful retry of the same operation
from an unrelated existing repository. Never overwrite an existing project or
create `my-webapp-2` as an implicit fallback. Renaming a configured key must not
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

Use a UUID for an internal operation/idempotency identifier, not as a replacement
for the repository name. Retrying a successful Save should return the recorded
result for the same operation rather than creating another repository.

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
- A duplicate detected during Save is reported even if the earlier check passed.
- GitLab lookup failures are shown as unknown availability, never as a free name.
- No temporary GitLab administration credential reaches the UI or JSON export.
