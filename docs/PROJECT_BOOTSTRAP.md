# Project bootstrap: first managed application

## Intended workflow

The Wizard should manage an application as one project, including its GitLab
repository, generated CI configuration, environments and NGINX routing. Creating
a project should not require a second manual repository setup or copying CI YAML
into GitLab. This is the next functional extension, not behavior implemented by
the current label changes.

The first managed application will be **System Wizard itself**. Import its
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

1. Select the existing System Wizard source, a project key and the target GitLab
   namespace. Show the source and destination before creating anything.
2. Configure the application's enabled Production, Beta and Review environments,
   their domains and HTTP/HTTPS settings. Additional project runners remain
   optional; the existing instance runner pool is sufficient for this first app.
3. Create/import the GitLab repository and record its identity with the project
   configuration. An existing destination must be detected and explicitly linked
   rather than silently overwritten.
4. Generate and install the CI configuration for those settings. Preserve the
   upstream pipeline and its deliberate public domains; a separate managed CI
   path is preferable for the locally imported project. Account for the actual
   default branch and the Wizard's existing build/runtime requirements.
5. Apply the project networks and NGINX routing, start the pipeline, and show links
   to the repository, pipeline and enabled application environments.
6. Build and test a separate Wizard deployment. Promotion to the configuration UI
   remains an explicit operation so a failed build does not remove the working UI.

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
- No temporary GitLab administration credential reaches the UI or JSON export.
