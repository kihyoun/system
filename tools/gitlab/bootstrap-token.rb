# Narrow native exception: GitLab's official Rails model creates the initial
# administrator token. All provisioning, storage, renewal and revocation are TS.
require 'json'
operation = ENV.fetch('SYSTEM_BOOTSTRAPPER_AUTH_OPERATION')
raise 'Invalid bootstrap operation' unless operation.match?(/\A[a-f0-9]{48}\z/)
admin = User.find_by_username('root')
raise 'No active administrator' unless admin&.admin? && admin.active?
token = admin.personal_access_tokens.create!(
  name: "system-bootstrapper-initial-#{operation}", scopes: ['api'], expires_at: Date.tomorrow)
puts JSON.generate(id: token.id, userId: admin.id, token: token.token,
  name: token.name, expiresAt: token.expires_at.to_s)
