require 'json'
require 'net/http'
require 'uri'
require 'date'
require 'stringio'
class BootstrapError < StandardError; end
def Date.tomorrow = today + 1
load File.expand_path('../../project-bootstrap/preview-setup/provision.rb', __dir__)
load File.expand_path('../../project-bootstrap/wizard-environments/source-primary-activate.rb', __dir__)
operation = 'a' * 48
input = {'action' => 'preview-setup-preflight', 'namespace' => 'team', 'operation' => operation,
  'sources' => [{'mode' => 'import', 'project' => 'wizard-fork', 'ciPath' => '.gitlab/primary.yml'}]}
project = nil
variables = {}
calls = []
api = lambda do |method, route, body = nil|
  calls << [method, route, body]
  if method == Net::HTTP::Get
    result = case route
    when 'namespaces?per_page=100' then [{'id' => 9, 'full_path' => 'team'}]
    when 'runners/all?per_page=100&status=online', 'projects/7/runners?per_page=100' then [{'id' => 2, 'paused' => false, 'status' => 'online'}]
    when 'runners/2' then {'id' => 2, 'paused' => false, 'status' => 'online', 'tag_list' => ['docker', 'wizard-source-primary']}
    when 'projects/team%2Fwizard-fork', 'projects/7' then project
    else
      if route.start_with?('projects/7/variables/')
        key = route.delete_prefix('projects/7/variables/').split('?').first
        variables[key]
      else
        raise 'unexpected lookup: ' + route
      end
    end
    [result.nil? ? 404 : 200, result]
  elsif method == Net::HTTP::Post && route == 'projects'
    project = body.transform_keys(&:to_s).merge('id' => 7, 'namespace' => {'id' => 9}, 'path_with_namespace' => 'team/wizard-fork')
    [201, project]
  elsif method == Net::HTTP::Post && route == 'projects/7/variables'
    row = body.transform_keys(&:to_s); variables[row.fetch('key')] = row
    [201, row]
  elsif method == Net::HTTP::Post && route == 'projects/7/access_tokens'
    raise 'overprivileged source credential' unless body[:scopes] == ['write_repository'] && body[:access_level] == 40 && body[:expires_at] == Date.tomorrow.to_s
    [201, {'id' => 12, 'token' => 'fixture-only-secret'}]
  elsif method == Net::HTTP::Delete && route == 'projects/7/access_tokens/12'
    [204, nil]
  else
    raise 'unexpected write: ' + route
  end
end
result = BootstrapperPreviewSetup.new(api, input).call
raise 'preflight omitted namespace' unless result[:namespaceId] == 9
raise 'preflight made a write' unless calls.all? { |row| row[0] == Net::HTTP::Get }
setup = input.merge('action' => 'preview-setup-project', 'source' => input['sources'][0])
result = BootstrapperPreviewSetup.new(api, setup).call
raise 'fresh credentials not scoped to project' unless result.dig(:credential, :id) == 12
raise 'new import inherited Auto DevOps' unless project['auto_devops_enabled'] == false
raise 'new import lost native CI path' unless project['ci_config_path'] == '.gitlab/primary.yml'
raise 'source gates weakened' unless project['only_allow_merge_if_pipeline_succeeds'] && project['only_allow_merge_if_all_discussions_are_resolved']
raise 'private delivery missing' unless variables.dig('WIZARD_DELIVERY_ENABLED', 'value') == 'true'
raise 'fork can publish upstream' unless ['GITHUB_BACKUP_ENABLED', 'DOCKERHUB_PUBLISH_ENABLED', 'GITHUB_RELEASE_PUBLISH_ENABLED', 'WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED'].all? { |key| variables.dig(key, 'value') == 'false' }
BootstrapperPreviewSetup.new(api, input.merge('action' => 'preview-setup-revoke', 'projectId' => 7, 'tokenId' => 12)).call
# Every batch is bounded and wholly authorized before its first API lookup.
batch_input = {'action' => 'preview-setup-read-many', 'projectIds' => [7], 'routes' => ['projects/7'] * 32}
count = calls.length
raise 'bounded batch lost response order' unless BootstrapperPreviewSetup.new(api, batch_input).call[:values] == [project] * 32
raise 'batch made non-GET requests' unless calls.drop(count).length == 32 && calls.drop(count).all? { |row| row[0] == Net::HTTP::Get }
invalid = [nil, [], ['projects/7'] * 33, ['projects/7', 'projects/8'], ['projects/7', 'projects/7/access_tokens'],
  ['projects/7', "projects/7\r"], ['projects/7', "projects/7\0"], ['projects/7', 'projects/7/../8'],
  ['projects/7', 'projects/7/repository/files/' + 'a' * 2048], ['projects/7', 7]]
invalid.each do |routes|
  count = calls.length
  begin
    BootstrapperPreviewSetup.new(api, batch_input.merge('routes' => routes)).call
    raise 'invalid evidence batch was accepted'
  rescue BootstrapError
    raise 'invalid batch read before complete authorization' unless calls.length == count
  end
end
large_api = lambda { |method, _route, _body| raise 'batch wrote GitLab state' unless method == Net::HTTP::Get; [200, {'content' => 'x' * 800000}] }
begin
  BootstrapperPreviewSetup.new(large_api, batch_input.merge('routes' => ['projects/7', 'projects/7'])).call
  raise 'oversized aggregate evidence was accepted'
rescue BootstrapError
  # The outer provisioner still revokes its normal temporary PAT in ensure.
end
# Exercise the actual outer dispatcher and credential ensure without Rails or
# HTTP. Successful, invalid, oversized and interrupted batches all revoke PATs.
User = Class.new unless defined?(User)
admin = Object.new
admin.define_singleton_method(:admin?) { true }
admin.define_singleton_method(:active?) { true }
tokens = Object.new
tokens.define_singleton_method(:where) { |*_args| self }
tokens.define_singleton_method(:find_each) { nil }
minted = revoked = network = 0
tokens.define_singleton_method(:create!) do |*_args|
  minted += 1
  token = Object.new
  token.define_singleton_method(:token) { 'fixture-only-native-credential' }
  token.define_singleton_method(:revoke!) { revoked += 1 }
  token
end
admin.define_singleton_method(:personal_access_tokens) { tokens }
User.define_singleton_method(:find_by_username) { |_name| admin }
original_start = Net::HTTP.method(:start)
begin
  [:success, :invalid, :oversized, :transport_loss].each do |scenario|
    network = 0
    http = Object.new
    http.define_singleton_method(:request) do |_request|
      network += 1
      raise IOError, 'fixture-only-native-credential' if scenario == :transport_loss
      body = JSON.generate(scenario == :oversized ? {'content' => 'x' * 1500000} : {'id' => 7})
      Struct.new(:code, :body).new('200', body)
    end
    Net::HTTP.define_singleton_method(:start) { |*_args, **_options, &block| block.call(http) }
    selected = batch_input.merge('routes' => scenario == :invalid ? ['projects/7', 'projects/8'] : ['projects/7'])
    Object.send(:remove_const, :BOOTSTRAPPER_INPUT) if defined?(BOOTSTRAPPER_INPUT)
    Object.const_set(:BOOTSTRAPPER_INPUT, [JSON.generate(selected)].pack('m0'))
    previous_stdout, $stdout = $stdout, StringIO.new
    begin
      load File.expand_path('../../project-bootstrap/provision.rb', __dir__)
      response = $stdout.string
    ensure
      $stdout = previous_stdout
    end
    raise 'native read credential was not revoked' unless minted == revoked
    raise 'credential leaked through failed native batch' if response.include?('fixture-only-native-credential')
    parsed = JSON.parse(response)
    raise "native batch dispatcher failed (#{scenario}): #{parsed}" unless scenario == :success ? parsed['values'] == [{'id' => 7}] : parsed['state'] == 'failed'
    raise 'invalid native batch started HTTP' if scenario == :invalid && network != 0
  end
ensure
  Net::HTTP.define_singleton_method(:start, original_start)
end
# Existing owned imports and operator-selected sources keep their settings.
project['auto_devops_enabled'] = true
BootstrapperPreviewSetup.new(api, setup).call
raise 'existing import Auto DevOps was rewritten' unless project['auto_devops_enabled'] == true
project['description'] = 'operator project'
existing = setup.merge('source' => setup.fetch('source').merge('mode' => 'existing'))
count = calls.length
result = BootstrapperPreviewSetup.new(api, existing).call
raise 'existing operator settings were changed' unless project['auto_devops_enabled'] == true && calls.drop(count).all? { |row| row[0] == Net::HTTP::Get }
raise 'existing project received an import credential' if result[:credential]

count = calls.length
begin
  BootstrapperPreviewSetup.new(api, setup).call
  raise 'unrelated project was reused'
rescue BootstrapError
  raise 'conflict wrote to operator project' unless calls.drop(count).all? { |row| row[0] == Net::HTTP::Get }
end

# Initial environment variables are created only for the explicit server-owned
# bootstrap reservation. Ordinary adoption keeps its existing strict value guard.
settings = {'review' => {'enabled' => true, 'host' => 'review.example.test'}, 'beta' => {'enabled' => false, 'host' => ''}}
environment = {'helperImage' => 'sha256:' + 'b' * 64, 'operation' => operation, 'settings' => settings, 'initialVariablesMissing' => true}
variables = {}
initial = {'environments' => environment, 'sourcePrimary' => {'bootstrap' => true}, 'action' => 'wizard-environments-primary'}
helper = WizardSourcePrimaryEnvironments.new(api, initial, {'id' => 7})
status = WizardSourcePrimaryEnvironments.new(api, initial.merge('action' => 'wizard-environments-primary-status'), {'id' => 7})
count = calls.length
raise 'status did not report missing variables' unless status.send(:synchronize).dig(:environments, 'phase') == 'pending'
raise 'status created initial variables' unless variables.empty? && calls.drop(count).all? { |row| row[0] == Net::HTTP::Get }
raise 'initial variables not ready' unless helper.send(:synchronize).dig(:environments, 'phase') == 'ready'
raise 'wrong initial Review variable' unless variables.dig('WIZARD_REVIEW_HOST', 'value') == 'review.example.test'
variables.delete('WIZARD_REVIEW_HOST')
ordinary = WizardSourcePrimaryEnvironments.new(api, initial.merge('sourcePrimary' => {'bootstrap' => false}), {'id' => 7})
raise 'ordinary binding recreated missing variables' unless ordinary.send(:synchronize).dig(:environments, 'phase') == 'requires-reconciliation'
puts 'Preview setup native adapter: read-only preflight, detailed runner access, owned private import, merge/publication guards, scoped credentials and initial-only resumable environment variables passed.'
