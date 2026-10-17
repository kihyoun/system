# Explicit local audit after the integration test has completed.
require 'json'
require 'net/http'
require 'digest'

credential = nil
begin
  admin = User.find_by_username('root')
  raise 'Setup PAT was not revoked' unless admin.personal_access_tokens.where(
    name: 'system-bootstrapper-project-setup', revoked: false).count == 0
  project = Project.find_by_full_path('root/bootstrapdemo')
  raise 'Wrong repository identity or visibility' unless project && project.name == 'bootstrapdemo' &&
    project.path == 'bootstrapdemo' && project.private?
  raise 'Duplicate project' unless Project.where(namespace_id: project.namespace_id, path: 'bootstrapdemo').count == 1
  raise 'Wrong CI path' unless project.ci_config_path == '.system-bootstrapper/ci.yml'
  content = project.repository.blob_at(project.default_branch, project.ci_config_path).data
  raise 'CI signature changed' unless content[807] == '$' && Digest::MD5.hexdigest(content[0, 1184]) == 'bd4a8426355824593a5e21ad759830c1'
  credential = admin.personal_access_tokens.create!(name: 'system-bootstrapper-project-audit', scopes: ['api'], expires_at: Date.tomorrow)
  uri = URI("http://127.0.0.1/api/v4/projects/#{project.id}/ci/lint")
  request = Net::HTTP::Post.new(uri)
  request['PRIVATE-TOKEN'] = credential.token
  request['Content-Type'] = 'application/json'
  request.body = JSON.generate(content: content)
  response = Net::HTTP.start(uri.hostname, uri.port) { |http| http.request(request) }
  lint = JSON.parse(response.body)
  raise "CI lint rejected: #{lint['errors']}" unless response.code == '200' && lint['valid']
  puts JSON.generate(private_repository: true, unique_path: true, default_branch: project.default_branch,
    ci_valid: true, ci_signature_valid: true, setup_credentials_revoked: true)
ensure
  credential.revoke! if credential
end
