# Credential expiry

Open **Credential expiry** in the connected Wizard to inspect metadata for the
operator-selected automation projects. The overview is read-only: it does not
rotate credentials, create an administrator token, change a CI variable, or test
a secret against an external service. Secret values and private token lookup stay
inside GitLab Rails; the browser receives only filtered purpose, provider, project,
expiry and status fields.

## Select projects and save monitoring settings

Enter each exact namespace/project path on a separate line. Only these projects
are inspected; there is no installation-specific project name or broad project
scan. At most eight distinct paths are allowed. Set the warning period to an
integer from 1 through 90 days; the default is 14 days.

**Save monitoring settings to form** updates the local form only. Use ordinary
**Backup** and **Push**, then reconnect and refresh the overview, to preserve and
apply those settings. Opening the dialog, editing a date or pressing **Refresh
metadata** does not push configuration automatically. The server reads the saved
configuration and can cache a result for up to five minutes.

The runtime options are `SYSTEM_CREDENTIAL_PROJECT_PATHS`, a JSON array of exact
paths, and `SYSTEM_CREDENTIAL_WARNING_DAYS`, the warning period. For example, the
project-path value could be:

```json
["example/system", "example/wizard"]
```

The optional `SYSTEM_CREDENTIAL_EXPIRY_METADATA` records external expiry dates.
Its JSON array entries contain only `projectPath`, `key` and `expiresAt`. Each
entry must name a selected project, a supported external key and a real calendar
date. The external-date editors produce this value; at most one entry per project
and key is accepted. A value could be:

```json
[{"projectPath":"example/system","key":"DOCKERHUB_TOKEN","expiresAt":"2027-01-01"}]
```

## What the overview establishes

The server reads only four fixed CI-variable keys in the selected projects:
`RENOVATE_TOKEN`, `SYSTEM_RELEASE_GITLAB_TOKEN`, `GITHUB_RELEASE_TOKEN` and
`DOCKERHUB_TOKEN`. It does not return their values. For the first two keys, GitLab
Rails resolves the existing local GitLab personal-access-token metadata without
creating or retaining a new administrator token. Existing GitLab metadata can
report an expiry date and revocation.

For GitHub and Docker Hub, expiry remains **unknown** unless the operator records
an expiry date. Such a date is marked **operator-recorded**; it is an assertion
about the intended external credential, not a verified provider response. A
missing or unrecognized token, unavailable expiry date or inaccessible metadata
also remains **unknown**. Unknown never means valid or non-expiring.

| Status | Meaning |
| --- | --- |
| Expiry valid | The observed or recorded expiry date is beyond the warning window. |
| Expiring soon | The expiry date falls within the configured warning window. |
| Expired | The expiry date has arrived. |
| Revoked | Local GitLab token metadata reports revocation. |
| Unknown expiry | No usable expiry date is available. |

Expiry dates take effect at **00:00 UTC on that date**, exclusively: a credential
with today's expiry date is already expired. A future date does not establish
that the credential still exists, authenticates successfully, has the required
scopes or can access its intended project. Recorded external dates can become
stale after independent rotation; update or remove them deliberately.

## Renew credentials through their owning tools

Use the renewal link for the affected purpose and follow the corresponding
repository-owned procedure. For Renovate, the existing `gitlab/renovate/setup.py`
workflow supports `--apply --rotate --enable` with the operator's private configuration.
For release metadata access, create a replacement project-scoped GitLab token
with the Reporter role, `read_api` scope and an explicit expiry date, then replace
the protected masked `SYSTEM_RELEASE_GITLAB_TOKEN` variable in the owning System
project. File-based credentials take precedence: when a corresponding private
token file is configured, replace that file through the operator's secret store
instead. Follow the documented [release credential configuration](RELEASES.md#trusted-publication-and-retry-behavior)
for GitHub Contents access and the selected credential sources.

For GitHub or Docker Hub publication, create the replacement through the provider,
limit access to the intended release/image repositories, and update the matching
protected CI credential in the owning project. Preserve its masking and protected
ref scope; use the configured private file when one has precedence. Update or
clear the operator-recorded expiry date at the same time. Confirm the next
authorized publication with the new credential before revoking the previous one;
the read-only expiry overview cannot prove that publication permissions work.
Missing dates or metadata remain unknown throughout this procedure.

Keep credential values out of browser forms, public configuration
exports, repository files, chat and logs. Do not introduce a permanent
administrator token merely to monitor expiry.

Importing ordinary configuration or monitoring metadata does not create or rotate
credentials. On a fresh installation without a matching Seed, selected project
paths describe desired monitoring targets only. Recreate the actual projects and
configure their required protected CI variables through the owning setup tools
before expecting automation to work. A metadata import is not secret recovery.
