# Initial GitLab credential boundary

`bootstrap-token.rb` is the narrow GitLab-native exception called by
`GitlabNativeApiService.bootstrap` through the installed GitLab Rails runner.
It creates one temporary `api` token for the existing active root administrator,
using GitLab's own model and token validation. The token expires the next day.
It accepts only a nonsecret 48-hex operation identifier through
`SYSTEM_BOOTSTRAPPER_AUTH_OPERATION` and returns credential material on its
private captured stdout. Do not invoke it in a pipeline, interactive console,
log collector or other caller that publishes stdout.

The script does not provision projects, create recurring identities, store
credentials, acquire operation locks or perform recovery. Those decisions
belong to the shared NestJS provisioning services. The caller must retain the
bootstrap credential privately, verify replacement credentials before switching
to them, and revoke the temporary token through GitLab's API when bootstrap work
is complete. An interrupted invocation can leave a token until its expiry;
process failure is not evidence that no token was created.

This boundary does not authorize operational Ruby scripts or arbitrary Rails
commands. See GitLab's [personal access token guidance](https://docs.gitlab.com/user/profile/personal_access_tokens/).
