# Runs only inside the bootstrapper's own GitLab container. The temporary
# credential never leaves this process; stdout contains only the runner token.
require 'json'
require 'net/http'

credential = nil
begin
  raise 'Automatic setup requires GitLab 16 or newer' if Gitlab::VERSION.to_i < 16
  admin = User.find_by_username('root')
  raise 'No active GitLab administrator' unless admin&.admin? && admin.active?
  # Clean up credentials left behind by an interrupted earlier operation.
  admin.personal_access_tokens.where(name: 'system-bootstrapper-runner-setup', revoked: false).find_each(&:revoke!)
  existing = Ci::Runner.instance_type.find_by(description: 'System Bootstrapper Docker pool')
  if existing
    # Recover after a lost config or an interrupted config write, without
    # creating another global runner. Local Rails access already has this power.
    result = {'id' => existing.id, 'token' => existing.token}
  else
    credential = admin.personal_access_tokens.create!(
      name: 'system-bootstrapper-runner-setup', scopes: ['create_runner'],
      expires_at: Date.tomorrow)
    uri = URI('http://127.0.0.1/api/v4/user/runners')
    request = Net::HTTP::Post.new(uri)
    request['PRIVATE-TOKEN'] = credential.token
    request.set_form_data(
      runner_type: 'instance_type', description: 'System Bootstrapper Docker pool',
      tag_list: 'docker,aws', run_untagged: 'true', locked: 'false',
      access_level: 'not_protected')
    response = Net::HTTP.start(uri.hostname, uri.port, open_timeout: 10, read_timeout: 30) do |http|
      http.request(request)
    end
    raise "Runner creation failed (HTTP #{response.code})" unless response.code == '201'
    result = JSON.parse(response.body)
    raise 'Runner authentication token missing' unless result['token'].to_s.start_with?('glrt-')
  end
ensure
  credential.revoke! if credential
end
puts JSON.generate(id: result.fetch('id'), token: result.fetch('token'))
