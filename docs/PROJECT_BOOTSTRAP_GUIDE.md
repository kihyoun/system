# Creating an application project

Connect the Wizard to Sync, Fetch the saved configuration, then open
**Projects → Add Project**. Enter a nonempty Project Key containing only lowercase
ASCII letters and digits. Choose a GitLab namespace and application template,
then configure Production, Beta and Review App hosts with their HTTP/HTTPS,
certificate and deployment settings. The destination below the key is the exact
repository path; domains do not change it. Existing stored keys are not renamed.

The key field distinguishes checking, available, occupied and unverified.
A local duplicate or occupied GitLab destination blocks creation. An API failure
does not mean a name is free. Save rechecks GitLab; a competing creation is
reported without linking to it, overwriting it or adding a suffix.

## Save and inspect the first pipeline

Save creates a private repository, uses its configured default branch, installs
managed CI at `.system-bootstrapper/ci.yml` and selects that CI path. Provisioning
runs server-side through an authenticated background job; the browser polls
short requests. Keep the form open until completion. A failed request can be
retried with Save. After a browser/service restart, Fetch the pending
configuration and use **Edit → Save** to resume the same operation.

The private operation receipt is stored in `.projects.env/.<key>.env`. Conflicting
configuration/service mutations are excluded while provisioning runs. Do not
replace a pending configuration or delete its receipt to bypass recovery.

React, Angular and General web projects receive editable application source,
Dockerfile, NGINX configuration and matching CI. React uses TypeScript/Vite;
Angular uses its CLI build. Both use Node 24 with pinned dependencies and
lockfiles. General web starts with static HTML/CSS/JavaScript and needs no Node
build. `GETTING_STARTED.md` in the created repository gives local commands.

Once routing is ready, Save starts the initial pipeline. It builds and pushes an
image, performs an HTTP smoke check and deploys automatic environments. Start
manual deployment jobs in GitLab. Inspect the pipeline link for the actual
result: a queued build does not mean an application is running. Retrying Save
recovers the initial pipeline instead of starting duplicates.

An **Empty repository** contains README and generated CI, not a running
application. Add source and a root Dockerfile compatible with the generated
Docker/Cypress workflow before building or deploying. Environment URLs are
configured destinations, not health checks.

Repository ID, path, URLs, default branch, managed CI path and operation state
survive Fetch and configuration Backup/Open. Ordinary environment edits use the
configuration/Push workflow; they do not rename the repository or automatically
rewrite committed CI. Review pipeline changes in the repository explicitly.

## Give an application a trusted HTTPS hostname

The Wizard saves the selected host, protocol and certificate paths; it does not
request a certificate. An environment URL or a successful HTTP deployment does
not prove that HTTPS has a trusted chain or a certificate covering that host.
Reusing the platform certificate works only when its subject alternative names
actually cover the application hostname.

This procedure uses a separate Certbot lineage for one exact application host.
Repeat it for additional Production, Beta or Review hosts. Wildcard HTTPS needs
an operator-configured DNS-01 certificate; HTTP-01 cannot issue wildcard
certificates. The managed system Wizard environments have their own
[activation procedure](../project-bootstrap/wizard-environments/README.md).

Prepare these operator inputs and prerequisites:

- A running platform from a reviewed release, with its native HTTP-01 route and
  public TCP 80/443 reachable. Its entry proxy must serve the shared challenge
  webroot for the selected hostname, including an already configured HTTP host.
  Older releases may lack that HTTP-host route; the challenge probe below must
  pass before issuance. Upgrade through the supported release procedure, or use
  a new, unassigned exact hostname whose requests reach the default ACME route.
- Public A/AAAA records for the application pointing only to the intended host.
  Check both address families; an obsolete AAAA record can break validation.
- The existing live-storage selector at
  `/etc/system-bootstrapper/persistence.env` and the host integration installed
  through [the public HTTPS setup](HANDBOOK.md#public-2-select-working-storage-and-install-certificate-integration).
  This installs `/usr/local/sbin/system-certbot`, the certificate deploy hook and
  `certbot.timer`. Reuse the saved storage selection; do not replace it with the
  handbook's fresh-install example. Certbot uses the distribution package at
  `/usr/bin/certbot`.
- A real ACME contact email and an unused lineage name. Here the exact hostname
  is also the lineage name. Inspect `sudo system-certbot certificates` before
  choosing it; do not replace another application's certificate state.

On the server, substitute your own values:

```bash
APP_HOST='app.example.com'
ACME_EMAIL='you@example.com'
dig +short A "$APP_HOST"
dig +short AAAA "$APP_HOST"
sudo env APP_HOST="$APP_HOST" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  install -d -m 0755 "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge"
  printf "%s\n" bootstrapper-application-acme-check > "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/$APP_HOST-check"
  chmod 0644 "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/$APP_HOST-check"
'
```

From outside the server, use the same application hostname:

```bash
APP_HOST='app.example.com'
curl --fail --silent --show-error --include \
  "http://$APP_HOST/.well-known/acme-challenge/$APP_HOST-check"
```

Require HTTP **200**, the exact `bootstrapper-application-acme-check` body and
no redirect. An application page, 404 or redirect means the challenge is not
reaching the shared webroot. Resolve DNS, firewall, release or routing settings
before requesting certificates; repeated issuance attempts are not a routing
diagnostic. The default ACME route supports an unassigned hostname, so a new
HTTPS environment need not be enabled with missing certificate files first.

After the probe passes, run on the server with the values set above:

```bash
sudo env APP_HOST="$APP_HOST" ACME_EMAIL="$ACME_EMAIL" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  /usr/local/sbin/system-certbot certonly --webroot \
    --webroot-path "$PERSISTENT_DIR/ssl/acme-http01" \
    --non-interactive --agree-tos --email "$ACME_EMAIL" \
    --cert-name "$APP_HOST" -d "$APP_HOST"
  RENEWED_LINEAGE="/etc/letsencrypt/live/$APP_HOST" /usr/local/sbin/system-install-certificate
  cmp "/etc/letsencrypt/live/$APP_HOST/fullchain.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/fullchain.pem"
  cmp "/etc/letsencrypt/live/$APP_HOST/privkey.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/privkey.pem"
'
```

This requests a production CA certificate. The installed hook copies the
lineage into live storage, validates NGINX and reloads the running entry proxy.
The explicit installer invocation verifies that deployment directly. Webroot
issuance leaves the proxy running and saves webroot authentication for future
renewals; do not stop NGINX or use standalone issuance on its occupied port 80.
If the certificate or deploy operation fails, fix it before changing the
application's HTTPS settings.

Fetch the saved configuration in the Wizard and keep a private configuration
Backup. If project provisioning is still pending, finish or resume that same
**Edit → Save** operation before ordinary configuration changes. Keep its
server-owned receipt; do not delete/recreate the project, change its key or edit
the receipt to bypass recovery. For a completed application, edit the intended
environment with these values, using your actual lineage name:

| Setting | Example |
| --- | --- |
| Enabled host | `app.example.com` |
| Domain mode | Exact-host HTTPS, mode `2` |
| SSL certificate | `/ssl/live/app.example.com/fullchain.pem` |
| SSL private key | `/ssl/live/app.example.com/privkey.pem` |

Save the environment edit and apply the configuration through **Push**. Use the
paths visible inside the platform's `/ssl` mount, not host
`/etc/letsencrypt` paths. This follows the ordinary service restart workflow;
plan for its interruption and reconnect/Fetch afterward. It does not issue a
certificate, rename the repository or rewrite committed environment URLs in
CI. Review those URLs in the application repository if its protocol changed.

From an external client with its normal CA trust store, verify the selected
hostname and application behavior. Choose a real client-side route and an
existing static file larger than 16 bytes from your deployed application:

```bash
APP_HOST='app.example.com'
APP_ROUTE='/your/spa/deep-link'
APP_FILE='/path/to/existing-file.ext'
curl --fail --silent --show-error --dump-header - --output /dev/null "https://$APP_HOST/"
curl --fail --silent --show-error --dump-header - --output /dev/null "https://$APP_HOST$APP_ROUTE"
curl --fail --silent --show-error --range 0-15 --dump-header - --output /dev/null \
  "https://$APP_HOST$APP_FILE"
```

These requests verify the server chain and URL hostname through normal TLS
validation. Do not disable certificate verification. Require the expected
application response for `/`, HTTP 200 with HTML for the SPA route, and HTTP
206 with `Content-Range: bytes 0-15/<file-size>` for the static file. Open the
HTTPS URL and deep link in a browser to verify that the application and its
assets render correctly. For a non-SPA application, use its documented route
behavior instead of expecting an HTML fallback.

Finally, on the server, exercise renewal and the deploy hook for this lineage:

```bash
sudo env APP_HOST="$APP_HOST" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  /usr/local/sbin/system-certbot renew --cert-name "$APP_HOST" --dry-run --run-deploy-hooks
  RENEWED_LINEAGE="/etc/letsencrypt/live/$APP_HOST" /usr/local/sbin/system-install-certificate
  cmp "/etc/letsencrypt/live/$APP_HOST/fullchain.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/fullchain.pem"
  cmp "/etc/letsencrypt/live/$APP_HOST/privkey.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/privkey.pem"
  docker exec system_web_1 nginx -t
'
```

Require successful simulated renewal and no failed deploy hook. Certbot can
report hook failure without a failing renewal exit status, so inspect its
output. The dry-run deploys the active trusted certificate, not the staging
certificate. Repeat the external HTTPS checks afterward, then enable/check the
shared timer and remove only this probe:

```bash
sudo systemctl enable --now certbot.timer
systemctl list-timers certbot.timer
sudo env APP_HOST="$APP_HOST" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  rm -- "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/$APP_HOST-check"
'
```

Keep DNS and public TCP 80 working for renewal. Retain the whole Certbot tree,
including accounts, archives and renewal configuration, through the normal
[Harvest/Seed recovery workflow](RECOVERY_CONTRACT.md). A lock error requires
resolving the active or interrupted certificate/Harvest operation; do not delete
its lock to force issuance. See the [renewal guidance](HANDBOOK.md#public-6-switch-unattended-renewal-to-the-running-proxy)
for deploy-hook diagnostics and recovery webroot rebinding.

### Browser data when changing HTTP to HTTPS

`http://app.example.com` and `https://app.example.com` are different browser
origins. Their localStorage data does not migrate automatically, even with the
same hostname and application image. Before changing the environment, use the
application's export/backup feature for any browser-held data you need, then
import it through the application at the HTTPS origin. Follow its own recovery
procedure if it has no export/import feature. A platform configuration Backup
or Harvest/Seed does not copy users' browser localStorage.

## Manage the system Wizard project

Startup with the configured Wizard enabled registers it as the first system
project. General supplies its existing Production host and certificates, so
registration creates no second proxy for that host. Edit/delete and ordinary
environment switches are disabled for this managed entry. Repeated startup
retains the repository and its server-owned workflow metadata. Resolve a local
key or repository ownership conflict before retrying startup.

Registration alone installs a disabled scaffold. Use the managed project actions
to [initialize pinned source](WIZARD_SOURCE.md), [build and verify a candidate](WIZARD_BUILD.md)
and configure [Review/Beta environments](../project-bootstrap/wizard-environments/README.md).
The optional environments begin disabled and require explicit host/certificate
configuration. Their deploy/stop jobs are manual. A candidate replaces the
Production interface only through the separate guarded
[operator promotion procedure](../project-bootstrap/wizard-production/README.md).

Push/Fetch and Open/Backup manage configuration independently of Harvest/Seed,
which handles persistent service data and certificates. Save actual
configuration backups privately; generated source repositories are not a place
for credentials or exported configuration.

## Verification

Build Sync with `cd sync && npm run build`. The isolated API regression
`node tests/gitlab/project-bootstrap.js` uses port 8071 and must run in a
disposable container/network namespace. It covers validation, authentication,
namespace conflicts, competing Save, recovery, polling, configuration-write
exclusion and Fetch round trips. Template generation is covered by
`node tests/gitlab/application-templates.js`.

For Wizard checks, use the Node/npm versions declared in `wizard/package.json`,
install with `npm ci`, then run `npm run lint`, `npm test`, `npm run build` and
`npm run test:config-export` from the Wizard directory. Tests cover metadata,
certificate/deployment settings, key validation and ignored stale responses.

`tests/gitlab/live/project-bootstrap.js` is an opt-in test for a disposable
platform. It takes Sync credentials through the environment and a
`PROJECT_PAYLOAD` JSON file containing `{projectKey, namespaceId, data, ci}` from
the Wizard generator. It creates or resumes its `bootstrapdemo` project, checks
concurrent/repeated Save and Fetch, and leaves that project for inspection. Do
not point it at an unrelated existing key. Template live checks are in
`tests/gitlab/live/application-templates.js` and
`tests/gitlab/live/application-templates-audit.rb`.

`tests/wizard/default-wizard.js` and
`tests/nginx/default-wizard-routing.sh` cover managed registration and single-route
behavior; `tests/wizard/live/default-wizard.js` is its authenticated live check.
Local HTTP fixtures do not demonstrate real DNS, certificate issuance/renewal,
GitLab job execution or a successful Production rollout. Exercise those gates
separately on an explicitly owned test platform.
