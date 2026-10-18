# System Bootstrapper Handbook

## 0. Getting Started

This chapter takes you from checkout to your first configured local platform.
You do not need Kubernetes experience. Run commands in Ubuntu, then configure
the platform in your browser.

The **Bootstrapper** starts and manages the services. The **Wizard** is its
React interface. The **Sync service** connects the interface to the Bootstrapper
instance. GitLab, the registry and runners are added after configuration.

### 0.1 Open Ubuntu and check out the project

On Windows, open an Ubuntu WSL2 console. If Ubuntu is not installed yet, first
run this command in PowerShell:

```powershell
wsl --install -d Ubuntu
```

Follow the installation steps and restart Windows if prompted. Then open Ubuntu.
Run all subsequent shell commands in the **Ubuntu console**, rather than PowerShell.

Install Git and download the project, including the Wizard submodule:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone --recurse-submodules https://github.com/kihyoun/system.git
cd system
```

The screenshots illustrate a local setup. The interface runs as a container
image: updating the Git checkout alone does not update that image. Build an image
from the pinned Wizard checkout as described in section 0.2.

### 0.2 Prepare Docker and build the Wizard image

Install the required Docker tools:

```bash
sudo bash bootstrapper/install.sh
```

The installer installs Docker and Compose and checks Docker using a test
container. For the local HTTP test, also configure the local hostnames and the
registry's HTTP exception:

```bash
sudo bash bootstrapper/prepare-local.sh
```

WSL may regenerate `/etc/hosts` at startup. If the registry or other local
hostnames later stop resolving, run this preparation step again. It reloads the
Docker configuration without restarting the containers. The HTTP exception
remains limited to the local test.

This guide uses HTTP exclusively for local testing. A publicly accessible
instance requires its own domain and HTTPS configuration.

The pinned Wizard uses React 19, Vite 8 and Node 24. Its Dockerfile selects the
exact Node image, installs the committed lockfile, runs its checks and builds the
interface. Build the local image from the checked-out submodule:

```bash
sudo docker build -t systembootstrapper/wizard:latest wizard
```

The image stays local and is not published to Docker Hub. Resolve any build
failure before continuing. For development outside Docker, use the Node and npm
versions declared in `wizard/.nvmrc` and `wizard/package.json`.

### 0.3 Start the Bootstrapper for the first time

Startup requires a separately mounted filesystem for persistent service data.
Prepare and mount your storage using the [persistent-volume guide](PERSISTENT_VOLUME.md)
before continuing; an ordinary directory on the root filesystem does not satisfy
the startup guard. Retain an existing filesystem's contents when reusing it.

Create the host selector file for your own mount. For example, if your filesystem
is already mounted at `/mnt/bootstrapper`, use:

```bash
sudo install -d -m 0755 /etc/system-bootstrapper
sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<'EOF'
PERSISTENT_MOUNT=/mnt/bootstrapper
PERSISTENT_DIR=/mnt/bootstrapper/platform
SEED_DIR=/mnt/bootstrapper/seed
EOF
sudo chmod 600 /etc/system-bootstrapper/persistence.env
```

Replace the example mount path in all three assignments if yours differs. Keep
`SEED_DIR` and `PERSISTENT_DIR` separate beneath the mounted filesystem. You can
also set `PERSISTENT_UUID` to require a specific filesystem identity.

Then run this command from the project's root directory:

```bash
sudo env \
  GITLAB_IMAGE=gitlab/gitlab-ce:19.4.2-ce.0 \
  GITLAB_RUNNER_IMAGE=gitlab/gitlab-runner:v19.4.0 \
  GITLAB_SSH_BIND=127.0.0.1:2222 \
  GITLAB_REGISTRY_BIND=127.0.0.1:5050 \
  bash start.sh
```

These selectors pin the GitLab and runner images for a **fresh installation**.
They are not an upgrade procedure for an existing GitLab database. Without these
explicit settings, the repository uses its historical GitLab default. When
reusing an installation, preserve its recorded image selectors and follow the
GitLab upgrade requirements rather than replacing them with this example.

The Bootstrapper builds its image and initially starts the Wizard and Sync
access point. GitLab is not fully configured at this stage. The first build
may take some time.

Check the containers and view the startup output with:

```bash
sudo docker ps
sudo docker logs system_bootstrapper_1
```

**Keep an Ubuntu console open under WSL** while using the platform. A running
systemd service alone does not keep the WSL instance alive.

### 0.4 Find the signature, server address and actual credentials

The original System Cube and listening address appear in the Bootstrapper output:

```text
server listening on http://<internal-container-ip>:8071
Sync authentication is configured.
```

Credentials are not printed in the logs. At first startup, generated credentials
are saved privately in `PERSISTENT_DIR/configuration/sync-auth.env`. Once a main
configuration exists, its `SYNC_USER` and `SYNC_PASS` override those initial values.

Run this command locally on your own Docker host to display only the active Sync
username and password. It uses the same precedence as startup:

```bash
sudo bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  source "$PERSISTENT_DIR/configuration/sync-auth.env"
  if [[ -f "$PERSISTENT_DIR/configuration/.docker.env" ]]; then
    source "$PERSISTENT_DIR/configuration/.docker.env"
  fi
  printf "Username: %s\nPassword: %s\n" "$SYNC_USER" "$SYNC_PASS"
'
```

Use the printed values in the connection dialog. Keep this terminal output
private. If you selected a custom `PERSISTENCE_ENV_FILE` at startup, use that
selector file in the command instead. Screenshots and placeholders do not
supply valid credentials for your installation.

The displayed container IP and port `8071` are the internal Node address. During
local first startup, access Sync from the browser at **`http://localhost/sync`**.
NGINX forwards this address to the Node service. The internal IP may change
whenever the container restarts.

### 0.5 Open the Wizard in your browser

Open [http://localhost/](http://localhost/).

If an older version is already open, reload the page. Use **Ctrl+F5** if the
interface looks outdated; the browser cache may still contain the previous version.

![Wizard before connecting: the pencil icon and Connect button are at the top right](images/getting-started/01-wizard-start.png)

Before loading a configuration, the form may contain Example values. This does
not mean GitLab has already been configured at those addresses. Do not click
Push or Seed yet.

### 0.6 Open Edit and enter the connection details first

Click the **pencil icon immediately to the left of Connect**. It opens the
**Connect** dialog with three input fields.

![Edit dialog showing Server Address and empty Username and Password fields](images/getting-started/03-edit-connection.png)

Enter the following:

| Field in the Edit dialog | Source of the value |
| --- | --- |
| **Server Address** | For this local first startup: `http://localhost/sync` |
| **Username** | The active Sync username displayed by the private local command in section 0.4 |
| **Password** | The active Sync password displayed by the same command |

**These credentials come from your own persistent configuration.** They are
separate from GitLab credentials. Do not copy them from the screenshot.

### 0.7 Connect after entering all three fields

Confirm the dialog with **Submit** after filling in all three fields. This
button signs you in; you do not need to click Connect again afterwards.

The Connect button in the main window is a shortcut using the connection settings
already stored there. Use the Edit dialog described above for your first login.

![Connected successfully: the server address, Disconnect and Synchronize are visible](images/getting-started/04-connected.png)

The server address, green dot, changed **Disconnect** button color and additional
**Synchronize** menu indicate a successful connection to the Bootstrapper instance.

### 0.8 Load the configuration with Fetch

Open **Synchronize** and select **Fetch**.

![Synchronize menu with the Fetch entry](images/getting-started/05-fetch-menu.png)

There are two cases:

- **The instance has a saved configuration:** Fetch loads those exact settings
  and the existing projects into the Wizard.
- **No main configuration has been transferred yet:** the current version requests
  derived suggestions from the connected Bootstrapper and loads them into the form.

![First startup after Fetch: suggested local hostnames marked with asterisks](images/getting-started/06-derived-settings.png)

An **asterisk** marks a derived value. Hover over it or focus it with the Tab key.
Its tooltip explains the source and asks you to verify the value before transfer.

![Asterisk tooltip explaining that derived data must be verified](images/getting-started/07-derived-tooltip.png)

Existing NGINX routes take priority when deriving suggestions. Otherwise,
hostnames may be suggested from the connection address. Suggestions do not set
up DNS or prove that a certificate exists. Unknown values remain empty;
passwords and runner tokens are not guessed.

Fetch does not write a new configuration to the server, but it replaces values
in your browser form. Use Backup first if you need to preserve unsent changes.

### 0.9 Complete the suggestions for the local test

Check the **Start**, **SSL**, **Sync** and **Wizard** sections under General:

| Setting | Value for this local test |
| --- | --- |
| `SEED_DIR` | Keep the path selected on the host, for example `/mnt/bootstrapper/seed` |
| `GITLAB_HOST` | `gitlab.localhost` |
| `GITLAB_REGISTRY_HOST` | `registry.localhost` |
| Gitlab Runners | Initially `0`; configure the runner after signing into GitLab |
| GitLab and registry under SSL | **Default, HTTP** |
| Enable Synchronization Server | Enable |
| `SYNC_HOST` | `sync.localhost` |
| `SYNC_USER` and `SYNC_PASS` | Choose and remember your own credentials for subsequent connections |
| Sync mode | **Default, HTTP** |
| Enable Wizard | Enable |
| `WIZARD_HOST` | `localhost` |
| Wizard mode | **Default, HTTP** |

The seed path is a directory on the Docker host. Keep it consistent with the
directory mounted at startup. A missing seed is normal on first startup and
means this is a fresh installation.

### 0.10 Back up, transfer and apply the configuration

1. Select **Backup → bootstrapper.json → Download** to save the editable
   configuration, or **Backup → bootstrapper.zip** for JSON plus generated
   environment files. Both contain credentials; keep them private.
2. Select **Synchronize → Push** and confirm the transfer. This sends the Wizard
   settings to the instance and automatically restarts services after a successful
   import. The interface is temporarily unavailable while services start.
3. Wait for the interface to return, then reconnect and Fetch to verify the settings.

**Push transfers and applies settings. No separate Restart click is required.**
Open loads a previously downloaded JSON file into the Wizard; loading the file
alone does not change the server configuration.

### 0.11 Open GitLab and sign in for the first time

GitLab's first startup may take several minutes. Check its status in Ubuntu:

```bash
sudo docker ps
```

The GitLab container should eventually report `healthy`. Then open
[http://gitlab.localhost/](http://gitlab.localhost/).

The GitLab administrator username is **`root`**. For a fresh database, the
Bootstrapper generates a random initial password. An installation prepared with
a complete private configuration may instead set `GITLAB_INITIAL_ROOT_PASSWORD`
to at least 12 characters in `PERSISTENT_DIR/configuration/.docker.env` before
GitLab's first startup. The Wizard has no dedicated field for this optional value.

Read the initial password locally after the first startup:

```bash
sudo docker exec system_gitlab_1 cat /etc/gitlab/bootstrapper_initial_root_password
```

This root-readable file is stored in GitLab's persistent configuration volume
and survives restarts. Sign in as `root` and keep the credentials private. The
file records the initial password; later password changes are not written back
to it. Harvest also includes it in the seed through the GitLab configuration
volume, so keep the seed private too.

An existing database is left unchanged. If it was set up without this mechanism,
no file containing an assumed login password is created retroactively. You can
check GitLab's native temporary file if it is still present:

```bash
sudo docker exec system_gitlab_1 grep 'Password:' /etc/gitlab/initial_root_password
```

GitLab may remove this native file on a container restart after 24 hours. If no
valid password is known, a targeted GitLab password reset is required. Sync
credentials are independent of the GitLab login.

### 0.12 Reconnect later and change settings

Open the Wizard again at [http://localhost/](http://localhost/). After completing
the setup above, the Sync address is **`http://sync.localhost`**, replacing the
first-startup `/sync` path.

Use the Edit dialog and the Sync credentials you chose in section 0.9. Load the
saved configuration with **Synchronize → Fetch**. You can change it, save a local
Backup, then apply it with Push (which restarts automatically).

For public use, configure your own DNS, HTTPS certificates and host certificate
renewal. Reusing a database or moving persistent storage requires the separate
[recovery procedure](RECOVERY_CONTRACT.md).

## 1. Main actions

| Action | What happens |
| --- | --- |
| Edit (pencil) | Opens the dialog for the server address and Sync credentials |
| Submit / Connect | Signs the Wizard into the Sync service |
| Disconnect | Disconnects the Wizard |
| Open | Loads a configuration file from your computer into the Wizard |
| Backup | Downloads configuration as JSON or a ZIP containing JSON and generated environment files |
| Fetch | Retrieves saved instance settings; without a configuration, the current version loads marked suggestions |
| Push | Transfers the Wizard configuration and automatically restarts the instance |
| Restart | Restarts services using the transferred configuration |
| Register / Unregister | Checks/registers or unregisters configured runner managers |
| Harvest | Publishes a cold snapshot of GitLab data, certificates and certificate-renewal state in the seed directory |
| Seed | Restores data from the seed; existing destination data may be overwritten |
| Reset | Deletes the main and project configurations through the reset workflow |
| Update | Updates source code through the existing update workflow |

**Configuration and persistent service data are managed separately.** Open/Backup
and Push/Fetch manage configuration. Harvest/Seed handle service data. Neither
configuration download includes the Seed, databases or registry contents. Harvest
and Seed are not needed to view a configuration with Fetch.

Current implementation detail: the existing Wizard **Seed** action also
transfers the main configuration from the form before restoring data. Check the
form before invoking it. First-startup suggestions did not change this coupling.
Use Push for the initial setup in chapter 0.

Harvest stops GitLab and requires a clean shutdown before copying its data. It
coordinates with certificate renewal and publishes a checksummed completion
manifest only after copying succeeds; previous completed snapshots remain
available. Seed validates the snapshot and requires the matching GitLab image
before restoring. Save a matching configuration backup separately and follow the
[recovery contract](RECOVERY_CONTRACT.md). A Seed on the same volume does not
protect against losing that volume.

## 2. Setting up GitLab runners

A runner executes jobs in your GitLab pipelines. It can be set up automatically
for the Bootstrapper's own GitLab instance. Automatic setup requires GitLab 16
or newer; the historical GitLab 12 image default does not support this workflow.
Use the image settings from chapter 0 for the local test.

### 2.1 Set the count and start the runners

1. Open the Wizard and connect to Sync using **Edit → Submit**.
2. Load the existing configuration with **Synchronize → Fetch** so the next Push
   preserves your configured hosts.
3. Under **Gitlab Runners**, enter the desired count, initially **1**. The allowed
   range is 0 to 50; choose a count appropriate for your computer's memory and CPU.
4. Leave **Runner authentication token** empty for automatic setup. A token
   already loaded by Fetch can stay in place: it will be reused.
5. Transfer and apply the settings with **Synchronize → Push**; restart is automatic.
   Wait for GitLab startup and runner registration.
6. Check the Ubuntu console:

   ```bash
   sudo docker ps
   ```

   With a count of 1, `runner_docker_1` should be present. A running container
   alone does not confirm successful registration. After registration, the
   Bootstrapper reports `Runner runner-docker-1 registered.`, or
   `Runner runner-docker-1 verified.` when checking an existing registration.
7. Sign into GitLab as an administrator and check **System Bootstrapper Docker
   pool** under **Admin → CI/CD → Runners**. Its connected runner managers must
   be online. Projects can use this instance runner when instance runners are
   enabled for that project.

The count means **runner containers in a shared instance runner pool**. GitLab
shows one runner entry with multiple managers, rather than a separate global
runner entry for each container. Open the runner's detail page and inspect
**Runner managers** for each container's system ID and online status. The
automatically created pool has the tags `docker` and `aws` and also accepts
untagged jobs.

### 2.2 Show the token and download the configuration

1. After restarting, reconnect the Wizard to the configured Sync address if
   needed, for example `http://sync.localhost` locally.
2. Select **Synchronize → Fetch**. The Wizard now also loads the generated runner
   token from the Bootstrapper configuration.
3. The token is hidden by default. Use **Show** to display and copy it from the
   input field; **Hide** conceals it again.
4. Select **Backup** to download the configuration, including its runner token,
   as Bootstrapper JSON. Keep this file private.

The export stores the token under `gitlabRunnerToken` and the count under
`gitlabRunnerScale`. The token belongs to that GitLab instance; an independent
new GitLab database will not recognize it. Leave the field empty again for
automatic first setup against a new database. Manually supplied tokens are also
supported and are not replaced with automatically generated ones.

### 2.3 What happens internally

The Bootstrapper waits for GitLab's readiness check and uses its existing Docker
access to its own GitLab container. Inside that container, it creates a temporary
administrator access token with the `create_runner` scope, creates the instance
runner through the GitLab API, and immediately revokes the access token, including
on API failure. The access token stays inside the GitLab process and appears in
neither the Wizard nor the JSON backup. It expires the following day as a fallback
for abrupt process termination; subsequent setup also revokes leftover setup tokens.

Only the runner authentication token is saved in the Bootstrapper configuration.
Repeated registration reuses the existing pool. Each manager persists its own
`config.toml` and system ID beneath `PERSISTENT_DIR/runners/<pool>/<index>/`.
Restarts reuse these identities. Scaling down retains the directories so a
later scale-up can reuse them; stopped managers can remain visible as offline
entries in GitLab. Do not delete the whole runner pool to remove one old manager.
Runners use the `gitlab` service name on the shared Docker network so a GitLab
restart with a different internal
IP does not break their connection. Register updates old internal IP endpoints
in managed runners without changing their tokens or externally configured addresses.
Recovery after interrupted configuration persistence locates the managed pool by
name. Keep that entry's name unchanged if you want this recovery behavior.

**Register** starts or scales runners using the saved configuration and checks
their registration. **Unregister** unregisters the managers. With modern token
registration, the global runner entry remains in GitLab. Count **0** stops the
runner containers without deleting the pool or token. Wizard changes are only
transferred when you use Push.

This setup does not change the Harvest/Seed cycle. Bootstrapper configuration
continues to be managed through Push/Fetch and Open/Backup.

### 2.4 Local functional test

For an explicitly disposable local test instance, `tests/gitlab-runner/live/runner.py` creates
a private test project and pipeline, checks the runner and downloads the generated
result file. It creates a separate temporary test access token with the `api`
scope and revokes it afterwards. This is a test helper; actual runner setup only
requires `create_runner`.

If runner setup fails, platform startup continues so you can correct the
configuration in the Wizard. Check the Bootstrapper output, correct the settings
and try **Register** again.

```bash
sudo python3 tests/gitlab-runner/live/runner.py
```

Prerequisites are running local services, Docker access, and the addresses
`gitlab.localhost` and `sync.localhost` on the local HTTP proxy.

## 3. Configuring applications and environments

The Wizard's **Projects** section was previously named **Proxy**. It describes an
application with its **Production**, **Beta** and **Review Apps** environments.
Use **Add Project** to create its deployment configuration. An NGINX proxy forwards
requests for configured domains to the corresponding application containers.
The proxy is one part of the application configuration.

Some images in chapter 0 still show the former **Proxy** label. The current
interface uses **Projects** in the same location.

For new projects, the **Project Key** is exactly the GitLab name and path. Only
lowercase letters a–z and digits are allowed; existing stored keys are not renamed.

Connect the Wizard to Sync and use **Fetch** first. Under **Projects → Add Project**,
choose the namespace, check availability and configure the enabled environments
with their HTTP/HTTPS settings. **Save** creates a private GitLab repository with
a README and generated CI. Setup reports progress asynchronously. Occupied
repositories are neither adopted nor overwritten; repeated Save does not create
duplicates.

### 3.1 Start an application from a template

In the creation dialog, choose an **Application template**:

| Selection | Generated starter |
| --- | --- |
| React + TypeScript + Vite | React source, Vite build, lockfile and Dockerfile |
| Angular + TypeScript | Angular source, CLI build, lockfile and Dockerfile |
| General web project | HTML, CSS and JavaScript without a framework build, with a Dockerfile |
| Empty repository | Repository and CI only; add your own source later |

The first three options include a Dockerfile. Save creates the files and matching
CI and starts the first pipeline after configuring routing. The pipeline builds
and publishes the image, checks its HTTP response and starts automatic deployments.
For a manual deployment, start the corresponding job in GitLab yourself.

Open the pipeline link and wait for the build and deployment jobs to succeed
before checking the application domain. A repository link alone does not prove
that an application is running. You can then work directly on the generated
source; the Dockerfile and pipeline remain editable too. GETTING_STARTED.md in
the new repository explains the local commands. New Angular and React projects
build with Node 24, as does the System Wizard itself.

An empty repository is not yet a running application. In that workflow, the
pipeline waits for application source with a Dockerfile. Repository metadata
survives Fetch and JSON Backup/Open. See the [project guide](PROJECT_BOOTSTRAP_GUIDE.md)
for the complete instructions, including recovery after errors.

### 3.2 The automatically registered System Wizard

After the platform has a main configuration and GitLab is available, startup
automatically registers **wizard** as the first project when the Wizard is
enabled. Use Fetch after registration completes. Its Production URL, HTTP/HTTPS
mode and certificate paths come from the actual Wizard settings under General;
locally, the existing interface remains at `http://localhost`.

The project starts with a private `root/wizard` repository scaffold containing
README and managed CI. Expand its row and select **Initialize Wizard source**
to preview and explicitly import the pinned application source. See the
[source initialization guide](WIZARD_SOURCE.md) for preparation and safe retry.
This source-only action does not start a pipeline or deploy another interface.
After initialization, **Build and verify Wizard** opens a separate read-only
preview. **Enable build pipeline** explicitly installs the managed recipe and
starts or recovers its initial pipeline. See the [build workflow guide](WIZARD_BUILD.md)
for required matching versions, verified candidate evidence and safe recovery.
Build activation does not deploy the candidate. Optional Review and Beta
environments require explicit configuration and manual GitLab deployment jobs;
Production promotion uses its separate guarded operator workflow. The existing
Wizard container and Production route are reused, with no duplicate project proxy.
Manage the interface settings under General; the system project is read-only in
the project list. Its repository links and configuration survive Fetch, Backup,
Open, Push and restart. Repeated startup reuses the same repository.

If a local `wizard` key or an unrelated GitLab repository already exists, the
Bootstrapper reports the conflict without overwriting it. A registration failure
does not replace or stop the working interface. Check the Bootstrapper output,
resolve the reported conflict/readiness problem and restart to retry.

#### Build and check the Wizard manually

Before starting, use matching System and Wizard versions that expose the source
and build actions. The System image must contain its prepared pinned Wizard
source package. GitLab, its project registry and a shared runner accepting the
`docker` tag must be available. The runner needs the reviewed Docker executor
setup used by the managed recipe, including Docker/Buildx access and registry
connectivity. Confirm sufficient physical disk and RAM for the build; avoid
running competing infrastructure builds at the same time. New imports use the
pinned Node 24/React 19/Vite 8 source and matching modern build recipe. Existing
legacy imports require the explicit [upgrade procedure](../project-bootstrap/wizard-upgrade/README.md);
reimporting source is not an upgrade mechanism.

For the local WSL setup, run `sudo bash bootstrapper/prepare-local.sh` again
after a WSL restart if `registry.localhost` no longer resolves. WSL can regenerate
`/etc/hosts`. The preparation reloads Docker configuration without restarting
the running containers; retry the failed job in the same pipeline afterwards.

1. Open the existing Wizard address. Use the pencil icon beside **Connect** to
   enter the configured Sync address and your current Sync credentials, then
   choose **Submit**. After first setup, use the configured Sync domain rather
   than assuming the initial `http://localhost/sync` path is still correct.
2. Select **Synchronize → Fetch**. In **Projects**, expand the first **wizard**
   entry. Check its repository link and the existing Production address. If the
   managed entry is missing, resolve registration first; do not create a second
   Wizard project with **Add Project**.
3. If source is already initialized, retain its receipt and skip to step 4;
   do not reimport after managed build activation. Otherwise choose
   **Initialize Wizard source**. Check the preview's **Repository**,
   **Source revision** and **Files**, then choose **Import source**. Wait for
   completion. This imports the source pinned by this System version without
   starting a pipeline. If source was already imported, retain that receipt;
   reimporting is not a source-upgrade mechanism.
4. Close the source dialog and choose **Build and verify Wizard**. Check the
   **Repository**, **Imported commit** and **Recipe version**. The preview alone
   does not create a pipeline or change the repository.
5. Choose **Enable build pipeline** once. Wait for the controller operation to
   finish; it records the managed recipe and initial pipeline. An interrupted
   browser response is a reason to inspect/refresh the saved operation, not to
   delete its receipt or create another project.
6. Choose **Open pipeline** in the build dialog. In GitLab, inspect the same
   pipeline's `build:wizard` and `test:wizard` jobs. The first runs the
   pinned application checks and production build, then publishes a candidate
   image. The second pulls the immutable image and checks HTTP, rendered UI, Projects and SPA
   navigation in an isolated browser candidate. A pending runner or running job
   has not passed these checks.
7. Return to the Wizard and choose **Refresh status** after the jobs finish.
   Wait for **Candidate checks and the immutable artifact are verified** and
   **Verified candidate image**. Record the pipeline and the image reference
   ending in `@sha256:…`. A green pipeline alone does not replace the controller's
   required-job and matching-artifact verification.
8. Inspect the GitLab job artifacts if evidence is needed: `build-evidence.json`
   from `build:wizard`, and `wizard-evidence.json` plus `browser-evidence/` from
   `test:wizard`. Evidence belongs to that pipeline and commit. The recipe
   currently retains these artifacts for seven days; an expired artifact may
   prevent a later verification even when an earlier job was green.
9. Confirm the existing Wizard still opens at its original address. Fetch again
   and check that the same project/repository and Production address remain.
   Build verification does not replace the running interface. To deploy the
   candidate, configure the [managed Review and Beta environments](../project-bootstrap/wizard-environments/README.md)
   and use their manual GitLab jobs. Production promotion and rollback use the
   separate [guarded operator procedure](../project-bootstrap/wizard-production/README.md).

For failures, use the [build status and recovery table](WIZARD_BUILD.md#status-and-safe-continuation).
Retry failed jobs in the same GitLab pipeline, then refresh status. Resume only
when the dialog offers **Resume activation**, after **Refresh preview** confirms
the current state. **Pipeline creation has an uncertain outcome. Refresh only.** permits refresh
only and needs administrator inspection; never clear its durable checkpoint to
force another pipeline. Keep credentials out of screenshots, issue comments and
job-log excerpts.

### 3.3 Shared and additional runners

The runner settings have two different purposes:

| Location in the Wizard | Meaning |
| --- | --- |
| General → Gitlab Runners | Shared instance runner pool available to multiple GitLab projects |
| Projects → Additional runners (optional) | Additional runner containers for this application configuration, using a separately supplied token |

Start with **0** additional project runners. Your pipelines can use the shared
pool when instance runners are enabled for the GitLab project and the job tags
match. A value of 0 does not disable the shared runners; it simply starts no
additional containers for this application.

For additional runners, their GitLab registration and token determine which
projects can use them. Associating a runner with a Project Key alone does not
restrict it to that GitLab project. Automatic token creation in chapter 2 applies
to the shared instance pool.

## 4. Troubleshooting

| Observation | Next step |
| --- | --- |
| `localhost` does not open | Keep an Ubuntu console open and check `sudo docker ps` |
| Connect reports Network Error | Check the address through Edit: `http://localhost/sync` at local first startup, then the configured Sync domain |
| Login is rejected | Retrieve the active values using the private local command in section 0.4; saved main settings override first-startup credentials |
| The form contains Example values | Connect and run Fetch first; an unconnected form is not the server configuration |
| Fetch returns 404 on a fresh instance | Reload the Wizard; both the Wizard and Sync must use versions supporting suggestions |
| Saved Example values return | Fetch prioritizes saved settings. Correct them explicitly in the Wizard; suggestions do not overwrite existing configuration |
| GitLab is not reachable yet | After Push triggers its automatic restart, wait for `healthy` and inspect GitLab logs if needed |
| Four configured runner containers appear as one GitLab runner | Open the runner detail page and inspect **Runner managers**; the shared pool has one entry with independent manager system IDs |
| Startup reports missing persistent storage | Mount the configured filesystem and check `/etc/system-bootstrapper/persistence.env`; do not bypass the guard with a root-disk directory |
| A pipeline waits for its runner after a GitLab restart | Register checks the pool and updates managed internal IP endpoints to the stable Docker service name |
| A pipeline cannot resolve `registry.localhost` | Run `sudo bash bootstrapper/prepare-local.sh` again in Ubuntu; WSL may reset local hosts entries at startup |
| `docker ps` shows no separate Sync Node container | Expected: Node runs inside the Bootstrapper container. `system_sync_1` is the NGINX access point at first startup |

See [Prepare-Host.md](../Prepare-Host.md) for further technical details.
