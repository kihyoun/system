# Runs only through the bootstrapper's own GitLab Rails process. The caller
# captures the credential privately and revokes it after the exact image pull.
require 'json'
require 'base64'
input = JSON.parse(Base64.strict_decode64(WIZARD_RECOVERY_INPUT))
project = Project.find(Integer(input.fetch('projectId')))
raise 'Wizard recovery project identity mismatch' unless project.full_path == input.fetch('projectPath')
admin = User.find_by_username('root')
raise 'No active GitLab administrator' unless admin&.admin? && admin.active?
name = 'system-bootstrapper-wizard-image-recovery'
if input.fetch('action') == 'cleanup'
  project.deploy_tokens.where(name: name, revoked: false).find_each(&:revoke!)
  puts JSON.generate(revoked: true)
elsif input.fetch('action') == 'revoke'
  credential = project.deploy_tokens.find(Integer(input.fetch('tokenId')))
  raise 'Unowned recovery credential' unless credential.name == name && credential.scopes.map(&:to_s).sort == ['read_registry']
  credential.revoke!
  puts JSON.generate(revoked: true)
elsif input.fetch('action') == 'create'
  # The persistent startup lease excludes another operation. Recover credentials
  # left by an interrupted previous pull, never unrelated project credentials.
  project.deploy_tokens.where(name: name, revoked: false).find_each(&:revoke!)
  result = Projects::DeployTokens::CreateService.new(project, admin,
    {name: name, read_registry: true, expires_at: Date.tomorrow}).execute
  credential = result[:deploy_token]
  begin
    raise 'Cannot create registry recovery credential' unless result[:status] == :success && credential
    raise 'Unexpected credential privilege' unless credential.scopes.map(&:to_s).sort == ['read_registry']
    puts JSON.generate(id: credential.id, username: credential.username, token: credential.token)
  rescue StandardError
    credential.revoke! if credential&.persisted?
    raise
  end
else
  raise 'Unknown Wizard registry recovery action'
end
