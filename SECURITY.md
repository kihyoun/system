# Security policy

System Bootstrapper and Wizard security fixes are developed against the current
default branches and delivered through tested public releases. Use the most recent
tested release and review its release notes. Older releases do not have a separate
security maintenance commitment. A newer upstream GitLab or Runner image is not
an accepted platform upgrade: use the supported paired migration procedure.

## Report privately

Email [kihyoun@gmail.com](mailto:kihyoun@gmail.com) for confidential security reports,
including when you do not have access to the private GitLab source projects.
Use a subject such as "System Bootstrapper security report" and include the
affected version, impact and a minimal reproduction. Remove credentials, private
configuration exports and unrelated personal data. Email is the initial contact
route; agree on an appropriate private transfer before sending sensitive files.
Do not disclose an exploitable vulnerability in a public issue or GitHub PR.

If you already have source-project access, you may instead open a
[confidential GitLab issue](https://gitlab.system-bootstrapper.com/system-bootstrapper/system/-/issues/new?issuable_template=Confidential&issue[confidential]=true).
Confirm **Confidential** is selected before submitting; a link or template does
not enforce that setting if you clear it. Reports are tracked privately in
GitLab. Instance administrators, authorized project members and the reporter can
access confidential issues. Maintainers follow up using the initial contact or
the private issue; no fixed response time is promised.

Maintainers assess impact, reproduce the report, coordinate a fix and agree on
safe public disclosure with the reporter. Avoid public disclosure of exploitable
details while coordination is underway. Do not probe other people's installations
without their permission. Report a suspected leaked secret privately and rotate it
through its owner; a public code deletion does not revoke a credential.
