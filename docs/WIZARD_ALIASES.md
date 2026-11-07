# Canonical Wizard aliases

An installation can explicitly reserve additional DNS names that permanently
redirect to its configured Wizard origin. With `WIZARD_HOST=www.example.com` and
`WIZARD_DOMAIN_MODE=2`, an alias `example.com` redirects both
`http://example.com/a?x=1` and `https://example.com/a?x=1` to
`https://www.example.com/a?x=1`. Redirects use HTTP 308 and preserve the original
path and query. The target comes from saved configuration, never the incoming
Host header. No alias is inferred from a `www` prefix.

| Setting | Meaning |
| --- | --- |
| `WIZARD_ALIASES` | Optional space-separated exact DNS names. Empty or absent disables alias routes. |
| `WIZARD_ALIAS_SSL` | Optional certificate path inside NGINX, beneath `/ssl`. Defaults to `WIZARD_SSL`. |
| `WIZARD_ALIAS_SSL_KEY` | Optional private-key path beneath `/ssl`. Defaults to `WIZARD_SSL_KEY`. Set both overrides together. |

The Wizard must be enabled and have an exact canonical host with domain mode
`0` (HTTP target) or `2` (HTTPS target). An alias serves both HTTP and HTTPS even
when the canonical target is HTTP, so alias TLS still needs a certificate. The
selected certificate must cover **every alias** and its key must match. Configure
DNS, certificate issuance and renewal using the public-server installation
procedure before enabling aliases; this setting does not obtain certificates.
Preserve the full Certbot account and renewal tree as described in the handbook.

Names must contain valid DNS labels, with no schemes, ports, IP literals,
wildcards or trailing dots. Comparison ignores case. Duplicate aliases and a
canonical-host loop are refused. Assigned GitLab, registry and Sync names are
reserved, including applicable wildcard modes. Enabled production, beta and
review project names are reserved too, including the managed Wizard's optional
environments. A wildcard service `*.apps.example.com` reserves its subdomains;
it does not reserve `apps.example.com` itself. Empty alias configuration leaves
the installation's existing domain modes and routing contracts in place.

## Configure through the supported configuration workflow

Fetch the current saved configuration in the Wizard and download a private ZIP
backup. Extract it into a private directory, retaining `.docker.env` and
`.projects.env/` together. Use the helper from the reviewed checkout to produce
a new configuration file. Node is already included in the controller image; it
can also run the helper on a workstation with Node installed.

```sh
private_config_dir="$HOME/private-bootstrapper-config"
node nginx/wizard-aliases.js configure \
  --config "$private_config_dir/.docker.env" \
  --projects "$private_config_dir/.projects.env" \
  --alias example.com \
  --output "$private_config_dir/candidate.docker.env"
```

Repeat `--alias HOST` for each additional name. When the aliases use a different
certificate, add both `--certificate /ssl/live/aliases.example.com/fullchain.pem`
and `--key /ssl/live/aliases.example.com/privkey.pem`. Existing override settings
are retained when those arguments are omitted. To remove all redirects, use
`--clear` instead of the `--alias` arguments.

The helper validates the Cube signature, host conflicts and certificate-path
syntax before creating an exclusive mode-0600 output file. It changes only its
alias assignments, preserving the Cube and all unrelated configuration bytes.
It does not replace the input, print credentials, write live NGINX configuration
or restart services. Keep both the old configuration and the resulting file
private. Use an up-to-date complete project export so validation can account for
the installation's assigned project names.

In the Wizard, choose **Open** and select `candidate.docker.env`. Keep
`.docker.env` in the filename so Open identifies it as main configuration.
Review the canonical Wizard settings and existing projects, then choose
**Backup** to retain the updated JSON/ZIP and **Synchronize → Push** to apply it.
Fetch again before editing from another browser or an older form.

These settings use the Wizard's existing additional `runtimeOptions` support.
Fetch/Open preserves unknown main-environment keys there; JSON Backup/Open and
ZIP/Push carry them forward, including after unrelated form edits. There is no
dedicated alias form field. For an intentional JSON edit, put the values under
`main.runtimeOptions`, for example:

```json
{
  "WIZARD_ALIASES": "example.com",
  "WIZARD_ALIAS_SSL": "/ssl/live/example.com/fullchain.pem",
  "WIZARD_ALIAS_SSL_KEY": "/ssl/live/example.com/privkey.pem"
}
```

Do not substitute this fragment for a complete configuration backup. Ordinary
Push and project changes validate conflicts before changing saved configuration.
Start/reload validates the saved alias routing again before replacing templates.

## Rendering, restart and recovery

`nginx/start.sh` reconstructs `zz-wizard-aliases.conf.template` from the saved
main and project configuration on every start and reload. It overwrites that
template with empty content when aliases are disabled, so an earlier generated
route cannot survive removal. The registry-only recovery phase also clears it;
normal startup reconstructs it after the Wizard is available. No private helper
or retained template is required.

Configuration backup remains separate from service-data backup. Preserve the
updated Wizard JSON/ZIP with the matching completed Harvest/Seed. Restore both
into fresh live storage using the recovery procedure. Seed retains certificate
and service state; the separate configuration restores the alias settings. A
Seed without matching configuration is not a complete installation backup.
Normal operation does not need the backup medium attached.

## Verify a configured installation

Run the native verifier with the operator-supplied alias origin in addition to
its ordinary configured-service checks:

```sh
sudo python3 bootstrapper/verify-runtime.py check \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --baseline "$private_config_dir/pre-start-baseline.json" \
  --output "$private_config_dir/runtime-check.json" \
  --redirect-from https://example.com
```

Use the verifier's normal baseline, checkout and credential arguments for the
operation being performed. Where the installation requires an alias, keep
`--redirect-from` in its readiness invocation. Verify HTTP as well as HTTPS,
an encoded path with a query, and public TLS trust. Repeat after repository-owned
NGINX reload, service restart and a disposable configuration-plus-Seed restore.
The bundled platform tests perform these lifecycle checks with generic test
domains and a local ACME issuer.

Both alias virtual hosts serve `/.well-known/acme-challenge/` directly from
`/ssl/acme-http01`. An existing challenge returns its content without a redirect;
a missing challenge returns 404 without a Location header. Check certificate
renewal using the documented webroot/deploy-hook procedure, including NGINX
configuration validation and reload. A redirect response alone does not prove
that certificate issuance or renewal works.
