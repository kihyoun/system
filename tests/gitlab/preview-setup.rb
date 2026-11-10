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
# Dependent source discovery stays in one bounded native read invocation. All
# routes derive from its allowed project and the head SHA read in this call.
context_input = {'action' => 'preview-setup-source-context', 'projectId' => 7, 'projectIds' => [7]}
context_sha = 'a' * 40
branch_route = 'projects/7/repository/branches/main%2Fnative'
pipeline_route = "projects/7/pipelines?sha=#{context_sha}&ref=main%2Fnative&source=push&per_page=100"
jobs_route = 'projects/7/pipelines/31/jobs?per_page=100&include_retried=false'
tree_routes = ['.gitlab', '.system-bootstrapper/build-v1'].map do |directory|
  'projects/7/repository/tree?path=' + URI.encode_www_form_component(directory) + "&ref=#{context_sha}&recursive=true&per_page=100"
end
context_rows = {'projects/7' => {'id' => 7, 'default_branch' => 'main/native'},
  branch_route => {'commit' => {'id' => context_sha}},
  pipeline_route => [{'id' => 31, 'sha' => context_sha, 'source' => 'push', 'status' => 'success'}],
  jobs_route => [{'id' => 40, 'name' => 'build:wizard', 'status' => 'success'}],
  tree_routes[0] => [{'type' => 'blob', 'path' => '.gitlab/primary.yml'}],
  tree_routes[1] => [{'type' => 'blob', 'path' => '.system-bootstrapper/build-v1/build.sh'}]}
context_calls = []
context_api = lambda do |method, route, _body|
  raise 'source context wrote GitLab state' unless method == Net::HTTP::Get
  context_calls << route
  [200, JSON.parse(JSON.generate(context_rows.fetch(route)))]
end
context_read = lambda { |value = context_input| BootstrapperPreviewSetup.new(context_api, value).call }
result = context_read.call
raise 'source context lost exact project/head/pipeline/jobs/trees' unless result == {
  project: context_rows['projects/7'], branch: context_rows[branch_route], pipeline: context_rows[pipeline_route][0],
  jobs: context_rows[jobs_route], trees: tree_routes.map { |route| context_rows[route] }}
raise 'source context read artifacts or blobs before JavaScript job validation' unless context_calls == ['projects/7', branch_route, pipeline_route, jobs_route, *tree_routes]
['running', 'pending', 'canceled', 'skipped', nil].each do |status|
  context_calls.clear
  context_rows[pipeline_route] = status ? [{'id' => 31, 'sha' => context_sha, 'source' => 'push', 'status' => status}] : []
  result = context_read.call
  raise 'waiting source context lost current pipeline state' unless result[:pipeline]&.fetch('status') == status
  raise 'waiting source context read jobs/trees/blobs/artifacts' unless context_calls == ['projects/7', branch_route, pipeline_route]
  raise 'waiting source context returned unverified job/tree evidence' if result.key?(:jobs) || result.key?(:trees)
end
['failed', 'success'].each do |status|
  context_rows[pipeline_route] = [{'id' => 31, 'sha' => context_sha, 'source' => 'push', 'status' => status}]
  context_calls.clear
  raise 'terminal source context hid actual pipeline status' unless context_read.call[:pipeline]['status'] == status && context_calls.length == 6
end
# Other pipeline sources/SHAs must never displace the current normal push.
context_rows[pipeline_route].unshift({'id' => 90, 'sha' => 'b' * 40, 'source' => 'push', 'status' => 'success'},
  {'id' => 91, 'sha' => context_sha, 'source' => 'api', 'status' => 'success'})
raise 'source context selected fabricated or stale pipeline' unless context_read.call[:pipeline]['id'] == 31
context_rows[pipeline_route] = [context_rows[pipeline_route].last]
context_calls.clear
[context_input.merge('projectId' => 8), context_input.merge('projectIds' => nil), context_input.merge('projectIds' => []),
  *[0, -1, '7', 7.0].map { |id| context_input.merge('projectId' => id) }].each do |value|
  begin
    context_read.call(value)
    raise 'unscoped source context was accepted'
  rescue BootstrapError
    raise 'source context read before project authorization' unless context_calls.empty?
  end
end
[
  ['projects/7', {'id' => 8, 'default_branch' => 'main/native'}, 1],
  ['projects/7', {'id' => 7, 'default_branch' => 'a' * 2049}, 1],
  [branch_route, {'commit' => {'id' => 'not-a-sha'}}, 2],
  [pipeline_route, [{'id' => 0, 'sha' => context_sha, 'source' => 'push', 'status' => 'success'}], 3],
  ['projects/7', context_rows['projects/7'].merge('padding' => 'x' * 1500000), 1],
  [tree_routes[0], [{'type' => 'blob', 'path' => '.gitlab/proof'}] * 100, 5]
].each do |route, changed, expected_reads|
  original = context_rows[route]
  context_rows[route] = changed
  context_calls.clear
  begin
    context_read.call
    raise 'invalid/oversized source context was accepted'
  rescue BootstrapError
    raise 'source context continued after a bounded refusal' unless context_calls.length == expected_reads
  ensure
    context_rows[route] = original
  end
end
original_project, original_branch = context_rows['projects/7'], context_rows[branch_route]
context_rows['projects/7'] = original_project.merge('padding' => 'x' * 800000)
context_rows[branch_route] = original_branch.merge('padding' => 'x' * 800000)
context_calls.clear
begin
  context_read.call
  raise 'oversized aggregate source context was accepted'
rescue BootstrapError
  raise 'aggregate source context exceeded read bound' unless context_calls.length == 2
ensure
  context_rows['projects/7'], context_rows[branch_route] = original_project, original_branch
end
# A later invocation must resolve its own fresh branch SHA and tree refs.
advanced_sha = 'b' * 40
context_rows[branch_route] = {'commit' => {'id' => advanced_sha}}
advanced_pipeline_route = pipeline_route.sub(context_sha, advanced_sha)
context_rows[advanced_pipeline_route] = [{'id' => 32, 'sha' => advanced_sha, 'source' => 'push', 'status' => 'success'}]
advanced_jobs_route = jobs_route.sub('/31/', '/32/')
context_rows[advanced_jobs_route] = [{'id' => 41, 'name' => 'build:wizard', 'status' => 'success'}]
advanced_tree_routes = tree_routes.map { |route| route.sub(context_sha, advanced_sha) }
advanced_tree_routes.zip(tree_routes).each { |advanced, original| context_rows[advanced] = context_rows[original] }
context_calls.clear
result = context_read.call
raise 'source context reused a previous invocation head/pipeline/jobs/trees' unless result[:branch]['commit']['id'] == advanced_sha &&
  result[:pipeline]['id'] == 32 && result[:jobs][0]['id'] == 41 && context_calls == ['projects/7', branch_route, advanced_pipeline_route, advanced_jobs_route, *advanced_tree_routes]
context_rows[branch_route] = original_branch
puts 'Preview source discovery: ready context uses 6 scoped GETs; waiting uses 3; no artifact/blob GETs, strict bounds and fresh invocation identity passed.'
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
  [:success, :invalid, :oversized, :transport_loss, :context_success, :context_waiting, :context_invalid, :context_oversized, :context_transport_loss].each do |scenario|
    network = 0
    http = Object.new
    http.define_singleton_method(:request) do |request|
      network += 1
      raise IOError, 'fixture-only-native-credential' if [:transport_loss, :context_transport_loss].include?(scenario)
      value = if scenario.to_s.start_with?('context_')
        route = request.path.delete_prefix('/api/v4/')
        if scenario == :context_oversized
          context_rows.fetch(route).merge('padding' => 'x' * 1500000)
        elsif scenario == :context_waiting && route == pipeline_route
          []
        else
          context_rows.fetch(route)
        end
      else
        scenario == :oversized ? {'content' => 'x' * 1500000} : {'id' => 7}
      end
      body = JSON.generate(value)
      Struct.new(:code, :body).new('200', body)
    end
    Net::HTTP.define_singleton_method(:start) { |*_args, **_options, &block| block.call(http) }
    selected = batch_input.merge('routes' => scenario == :invalid ? ['projects/7', 'projects/8'] : ['projects/7'])
    selected = context_input.merge('projectId' => scenario == :context_invalid ? 8 : 7) if scenario.to_s.start_with?('context_')
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
    expected = case scenario
    when :success then parsed['values'] == [{'id' => 7}]
    when :context_success then parsed.dig('pipeline', 'id') == 31 && parsed['trees'].length == 2 && network == 6
    when :context_waiting then parsed['pipeline'].nil? && network == 3
    else parsed['state'] == 'failed'
    end
    raise "native batch dispatcher failed (#{scenario}): #{parsed}" unless expected
    raise 'invalid native batch started HTTP' if [:invalid, :context_invalid].include?(scenario) && network != 0
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
