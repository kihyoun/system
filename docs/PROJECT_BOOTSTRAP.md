# Project bootstrap

Project bootstrap connects application configuration to a private GitLab
repository, managed CI, environment networks and NGINX routing. The Wizard's
**Projects → Add Project → Save** flow performs provisioning through the
authenticated Sync service. See the [operating guide](PROJECT_BOOTSTRAP_GUIDE.md)
for the browser procedure.

## Application templates

| Template | Generated application |
| --- | --- |
| React | TypeScript/Vite application, locked dependencies, Node 24 build and NGINX runtime. |
| Angular | TypeScript/Angular CLI application, locked dependencies, Node 24 build and NGINX runtime. |
| General web project | Framework-free HTML, CSS and JavaScript served by NGINX without a Node build. |
| Empty repository | README and managed CI; application source and a root Dockerfile must be supplied separately. |

Template files are versioned under `project-bootstrap/templates/`. Source,
Dockerfile, runtime configuration and CI remain editable after creation.
Generated application pipelines build an image, publish it to the instance
registry, perform an HTTP smoke check and deploy enabled environments according
to their configured automatic/manual settings. The pipeline uses
`CI_DEFAULT_BRANCH` instead of assuming a branch name.

## Repository identity and collisions

The repository display name and path are exactly the Project Key: key `mywebapp`
creates `<selected-namespace>/mywebapp`. New keys must match `^[a-z0-9]+$`.
The UI and backend reject spaces, punctuation, uppercase letters and empty keys;
they do not silently normalize input. Existing stored keys remain importable.
GitLab reserved-name or namespace-permission failures are reported separately.

Production, Beta and Review domains are independent settings. Changing a domain
does not rename the repository. An occupied destination blocks creation; the
bootstrapper does not overwrite it, silently link it or invent a suffixed name.
The saved operation identifies a successful retry of the same request.

The debounced availability check uses the complete namespace/repository path.
Duplicate local keys also block creation. Lookup failures mean unverified
availability, and stale responses are ignored after changing the key or
namespace. Save rechecks GitLab and treats the actual create response as
authoritative, including races after an earlier successful check.

## Provisioning and recovery

The Sync service reserves the local key before asynchronous provisioning and
stores the operation receipt in `.projects.env/.<key>.env`. Repository creation,
template installation and CI selection run through the instance's GitLab Rails
adapter. A temporary scoped API credential stays server-side and is revoked
when the operation ends. No GitLab administration credential reaches the
browser or configuration export.

Repository identity is saved before routing is applied. A retry can therefore
repair routing or recover the initial pipeline without creating another
repository. Polling returns completion or a safe error through authenticated
short requests. Pending operations exclude conflicting configuration/service
mutations. An unrelated repository, edited managed file or uncertain external
result must be inspected rather than bypassed by resetting its receipt.

The selected CI path is `.system-bootstrapper/ci.yml`. Upstream publishing files
are preserved separately. Environment settings and generated routing must agree
with the managed pipeline. Project provisioning keeps GitLab running.

## Managing the Wizard itself

With the Wizard enabled and configured, startup automatically registers the
private `root/wizard` system project. It represents the existing interface;
its Production host, HTTP/HTTPS mode and certificate settings come from General.
Repeated startup retains repository identity, workflow receipts and installed
optional environment settings. An occupied local key or foreign repository is
reported without being overwritten.

Registration creates a disabled README/CI scaffold. Subsequent actions are
explicit and independent:

1. [Initialize source](WIZARD_SOURCE.md) from the committed System Wizard gitlink.
2. [Build and verify](WIZARD_BUILD.md) the imported application and immutable
   registry candidate.
3. Configure [Review and Beta](../project-bootstrap/wizard-environments/README.md)
   on separate HTTPS hosts and deploy/stop them through manual GitLab jobs.
4. Apply a verified candidate with the guarded
   [Production promotion and rollback procedure](../project-bootstrap/wizard-production/README.md).

Source import, candidate builds and Review/Beta deployment do not replace the
running management interface. Production promotion is an operator-confirmed
action. Importing source does not change the upstream repository or make this
instance the development source of truth; primary/backup repository selection
is a separate [configuration decision](GITLAB_GITHUB_BACKUP.md).

## Configuration and service data

Project identity and workflow receipts survive authenticated Fetch, Backup/Open,
Push and restart. The managed Wizard entry keeps its Production settings in
General, while optional managed environments use their dedicated dialog.
Harvest/Seed handles service data and certificates; configuration backup remains
separate. Keep secrets out of repository files and retained build evidence.
