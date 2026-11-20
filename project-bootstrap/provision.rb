# Executed only inside our GitLab container; credentials never leave Rails.
require 'json'
require 'base64'
require 'net/http'
require 'uri'

class BootstrapError < StandardError; end

input = JSON.parse(Base64.strict_decode64(BOOTSTRAPPER_INPUT))
credential = nil
result = nil
begin
  if input['action'] == 'token-expiry-status'
    puts JSON.generate(BootstrapperTokenExpiry.status(input))
    exit
  end
  raise BootstrapError, 'Use native project provisioning' if ['namespaces', 'availability', 'create', 'pipeline'].include?(input['action'])
  admin = User.find_by_username('root')
  raise BootstrapError, 'No active administrator' unless admin&.admin? && admin.active?
  # Only clean expired credentials: concurrent lookups must not revoke one another.
  admin.personal_access_tokens.where(name: 'system-bootstrapper-project-setup', revoked: false)
    .where('expires_at < ?', Date.today).find_each(&:revoke!)
  credential = admin.personal_access_tokens.create!(name: 'system-bootstrapper-project-setup',
    scopes: ['api'], expires_at: Date.tomorrow)
  api = lambda do |method, route, body = nil|
    uri = URI('http://127.0.0.1/api/v4/' + route)
    request = method.new(uri)
    request['PRIVATE-TOKEN'] = credential.token
    if body
      request['Content-Type'] = 'application/json'
      request.body = JSON.generate(body)
    end
    response = Net::HTTP.start(uri.hostname, uri.port, open_timeout: 10, read_timeout: 60) { |http| http.request(request) }
    [response.code.to_i, response.body.to_s.empty? ? nil : JSON.parse(response.body)]
  end
  if input['action'].start_with?('preview-setup-')
    result = BootstrapperPreviewSetup.new(api, input).call
  else
    key = input.fetch('projectKey')
    raise BootstrapError, 'Invalid Project Key' unless key.match?(/\A[a-z0-9]+\z/)
    namespace_id = Integer(input.fetch('namespaceId'))
    code, namespace = api.call(Net::HTTP::Get, "namespaces/#{namespace_id}")
    raise BootstrapError, 'Namespace lookup failed' unless code == 200
    full_path = namespace.fetch('full_path') + '/' + key
    encoded = URI.encode_www_form_component(full_path)
    wizard_actions = ['wizard-source', 'wizard-build', 'wizard-build-status', 'wizard-environments', 'wizard-environments-status', 'wizard-source-primary-status']
    bound = wizard_actions.include?(input['action']) && input['repository']
    if bound
      repository = input.fetch('repository')
      id = Integer(repository.fetch('id'))
      raise BootstrapError, 'Invalid bound Wizard project' unless id > 0
      code, project = api.call(Net::HTTP::Get, "projects/#{id}")
      raise BootstrapError, 'Bound Wizard project identity changed' unless code == 200 &&
        project['id'] == id && project['path_with_namespace'] == repository.fetch('path') &&
        project.dig('namespace', 'id') == namespace_id
    else
      code, project = api.call(Net::HTTP::Get, 'projects/' + encoded)
    end
    raise BootstrapError, 'Project lookup failed' unless [200, 404].include?(code)
    if input['action'] == 'wizard-source-primary-status'
      result = WizardSourcePrimaryStatus.new(api, input, project).call
    elsif ['wizard-environments', 'wizard-environments-status'].include?(input['action'])
      raise BootstrapError, 'Wizard repository missing' unless code == 200
      result = WizardEnvironmentsAdapter.new(api, input, project).call
    elsif ['wizard-build', 'wizard-build-status'].include?(input['action'])
      raise BootstrapError, 'Wizard repository missing' unless code == 200
      result = WizardBuildActivation.new(api, input, project).call
    elsif input['action'] == 'wizard-source'
      raise BootstrapError, 'Wizard repository missing' unless code == 200
      result = WizardSourceImport.new(api, input, project).call
    else
      raise BootstrapError, 'Unsupported legacy GitLab action'
    end
  end
rescue BootstrapError => error
  result = {state: 'failed', message: error.message}
rescue StandardError
  # Do not relay Rails/HTTP exceptions; they may include credentials or config.
  result = {state: 'failed', message: 'GitLab operation failed. Check readiness and namespace permissions, then retry Save.'}
ensure
  credential.revoke! if credential
end
puts JSON.generate(result)
