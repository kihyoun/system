require 'json'
require 'base64'
require 'digest'
require 'net/http'
require 'uri'
class BootstrapError < StandardError; end
require_relative '../../project-bootstrap/wizard-environments/activate'
def assert(value, message = 'assertion failed')
  raise message unless value
end
def rejects(pattern)
  begin
    yield
  rescue BootstrapError => error
    assert(error.message.include?(pattern), error.message)
    return
  end
  raise 'Expected rejection: ' + pattern
end
class EnvironmentLease
  attr_accessor :busy
  def with_connection
    yield self
  end
  def select_value(sql)
    !(sql.include?('pg_try') && @busy)
  end
end
module ActiveRecord
  class Base
    def self.connection_pool
      @pool ||= EnvironmentLease.new
    end
  end
end
class EnvironmentFixture
  attr_reader :files, :posts
  attr_accessor :interrupted, :race
  def initialize(input)
    @input = input; @posts = []; @parents = {}; @head = 'b' * 40
    build, workflow, legacy = input.fetch('build'), input.fetch('workflow'), input.fetch('legacyRecipe')
    source = JSON.generate({version: 1, operation: input.fetch('operation'), sourceRevision: workflow.fetch('sourceRevision'), manifestHash: workflow.fetch('manifestHash')})
    marker = JSON.generate({version: 1, operation: build.fetch('operation'), recipeHash: legacy.fetch('recipeHash'), sourceRevision: workflow.fetch('sourceRevision'), importCommit: workflow.fetch('importCommit')})
    @files = {'.system-bootstrapper/wizard-source.json' => row(source, 'a' * 40),
      '.system-bootstrapper/wizard-build.json' => row(marker, @head),
      '.system-bootstrapper/ci.yml' => row(legacy.fetch('ci'), @head),
      '.gitlab-ci.yml' => row('upstream CI', 'a' * 40), 'README.md' => row('upstream README', 'a' * 40)}
    legacy.fetch('files').each { |source_file| @files[source_file.fetch('path')] = row(source_file.fetch('content'), @head) }
  end
  def row(content, commit)
    {'content' => Base64.strict_encode64(content), 'last_commit_id' => commit}
  end
  def call(method, route, body = nil)
    if method == Net::HTTP::Get
      if route.include?('/repository/files/')
        name = URI.decode_www_form_component(route.split('/files/')[1].split('?')[0])
        return @files.key?(name) ? [200, @files.fetch(name)] : [404, {}]
      elsif route.include?('/repository/branches/')
        return [200, {'commit' => {'id' => @head}}]
      elsif route.include?('/repository/commits/')
        commit = route.split('/').last
        return [200, {'parent_ids' => @parents.fetch(commit)}]
      end
    elsif method == Net::HTTP::Post && route.end_with?('/repository/commits')
      @posts << body
      assert(body.fetch(:commit_message).include?('[skip ci]'))
      commit = (98 + @posts.length).chr * 40
      copy = Marshal.load(Marshal.dump(@files))
      body.fetch(:actions).each do |action|
        name = action.fetch(:file_path)
        if action.fetch(:action) == 'create'
          return [400, {}] if copy.key?(name)
        else
          return [400, {}] unless copy.fetch(name).fetch('last_commit_id') == action.fetch(:last_commit_id)
        end
        copy[name] = row(action.fetch(:content), commit)
      end
      @parents[commit] = [@race ? 'f' * 40 : @head]
      @files = copy; @head = commit
      raise BootstrapError, 'interrupted response' if @interrupted
      return [201, {'id' => commit}]
    end
    raise 'Unexpected fixture API request: ' + route
  end
end
legacy = {'version' => 1, 'recipeHash' => 'build-recipe', 'ci' => 'legacy managed CI',
  'files' => [{'path' => '.system-bootstrapper/build-v1/build.sh', 'content' => 'legacy checks'}]}
recipe = {'version' => 1, 'recipeHash' => 'environment-recipe', 'settingsHash' => '1' * 64,
  'helperImage' => 'sha256:' + '2' * 64, 'ci' => 'environment managed CI',
  'files' => [{'path' => '.system-bootstrapper/environments-v1/run.sh', 'content' => 'immutable environment helper invocation'}]}
environment = {'version' => 1, 'operation' => '3' * 48, 'recipeHash' => recipe.fetch('recipeHash'),
  'settingsHash' => recipe.fetch('settingsHash'), 'helperImage' => recipe.fetch('helperImage'),
  'controller' => 'system_bootstrapper_1', 'phase' => 'pending', 'settings' => {'review' => {'enabled' => true}}}
input = {'action' => 'wizard-environments', 'operation' => 'registration', 'controller' => 'system_bootstrapper_1',
  'repository' => {'id' => 1, 'path' => 'root/wizard', 'defaultBranch' => 'main'},
  'workflow' => {'sourceRevision' => 'c' * 40, 'manifestHash' => 'd' * 64, 'importCommit' => 'a' * 40},
  'build' => {'version' => 1, 'operation' => '5' * 48, 'activationCommit' => 'b' * 40,
    'recipeHash' => legacy.fetch('recipeHash'), 'phase' => 'candidate-verified',
    'artifact' => {'imageRef' => 'registry.example.test/root/wizard@sha256:' + '6' * 64}},
  'environments' => environment, 'recipe' => recipe, 'legacyRecipe' => legacy,
  'registryPrefix' => 'registry.example.test/root/wizard'}
project = {'id' => 1, 'path_with_namespace' => 'root/wizard', 'default_branch' => 'main', 'visibility' => 'private',
  'description' => 'System Bootstrapper operation registration', 'ci_config_path' => '.system-bootstrapper/ci.yml'}
fixture = EnvironmentFixture.new(input)
run = -> { WizardEnvironmentsAdapter.new(fixture.method(:call), input, project).call }
result = run.call[:environments]
assert(result['phase'] == 'recipe-installed' && result['activationCommit'] == 'c' * 40)
assert(fixture.posts.length == 1)
assert(run.call[:environments]['activationCommit'] == 'c' * 40 && fixture.posts.length == 1)
assert(Base64.decode64(fixture.files.fetch('.gitlab-ci.yml').fetch('content')) == 'upstream CI')
assert(Base64.decode64(fixture.files.fetch('.system-bootstrapper/build-v1/build.sh').fetch('content')) == 'legacy checks')
input['action'] = 'wizard-environments-status'
assert(run.call[:environments]['phase'] == 'recipe-installed' && fixture.posts.length == 1)
input['action'] = 'wizard-environments'
fixture = EnvironmentFixture.new(input); fixture.interrupted = true
assert(run.call[:environments]['phase'] == 'requires-reconciliation')
fixture.interrupted = false
assert(run.call[:environments]['activationCommit'] == 'c' * 40 && fixture.posts.length == 1)
fixture = EnvironmentFixture.new(input); fixture.race = true
rejects('branch raced') { run.call }
rejects('branch raced') { run.call }
assert(fixture.posts.length == 1, 'Raced commit was accepted or duplicated on retry')
fixture = EnvironmentFixture.new(input)
fixture.files['.system-bootstrapper/ci.yml'] = fixture.row('human edit', 'e' * 40)
rejects('content changed') { run.call }; assert(fixture.posts.empty?)
fixture = EnvironmentFixture.new(input)
fixture.files['.system-bootstrapper/environments-v1/run.sh'] = fixture.row('occupied', 'e' * 40)
rejects('occupied') { run.call }
fixture = EnvironmentFixture.new(input)
ActiveRecord::Base.connection_pool.busy = true
rejects('busy') { run.call }; assert(fixture.posts.empty?)
ActiveRecord::Base.connection_pool.busy = false
fixture = EnvironmentFixture.new(input)
prior = JSON.parse(JSON.generate(run.call[:environments]))
input['previousEnvironments'] = prior
input['previousRecipe'] = JSON.parse(JSON.generate(recipe))
input['environments'] = environment.merge('operation' => '7' * 48, 'recipeHash' => 'new-recipe', 'settingsHash' => '8' * 64)
input['recipe'] = recipe.merge('recipeHash' => 'new-recipe', 'settingsHash' => '8' * 64, 'ci' => 'updated managed CI',
  'files' => [{'path' => '.system-bootstrapper/environments-v1/run.sh', 'content' => 'new helper invocation'}])
prior['deployments'] = {'review' => {'active' => {'pipelineId' => 10}}}
rejects('Stop active') { run.call }
prior['deployments'] = {'review' => {'pending' => {'pipelineId' => 10}}}
rejects('Stop active') { run.call }
prior['deployments'] = {}
result = run.call[:environments]
assert(result['activationCommit'] == 'd' * 40 && fixture.posts.length == 2)
assert(run.call[:environments]['activationCommit'] == 'd' * 40 && fixture.posts.length == 2)
assert(Base64.decode64(fixture.files.fetch('README.md').fetch('content')) == 'upstream README')
assert(fixture.posts.all? { |body| body.fetch(:actions).none? { |a| a.fetch(:file_path) == '.gitlab-ci.yml' || a.fetch(:file_path).include?('/build-v1/') } })
puts 'Environment upgrade: ownership, prior verified build, exact content, skip-CI atomic install/update, occupied paths, active lease refusal, interrupted/raced commit recovery and read-only status passed.'
require_relative '../../project-bootstrap/wizard-environments/verify'
activation, pipeline_sha = 'a' * 40, 'e' * 40
managed = [
  {'path' => '.system-bootstrapper/build-v1/build.sh', 'content' => 'real build and immutable digest evidence'},
  {'path' => '.system-bootstrapper/build-v1/Dockerfile', 'content' => 'RUN real checks'},
  {'path' => '.system-bootstrapper/build-v1/verify.sh', 'content' => 'real browser checks'},
  {'path' => '.system-bootstrapper/wizard-build.json', 'content' => 'canonical Phase B marker'}
]
repo = managed.to_h { |file| [file.fetch('path'), {'content' => Base64.strict_encode64(file.fetch('content')), 'last_commit_id' => activation}] }
repo['src/App.tsx'] = {'content' => Base64.strict_encode64('legitimate MR source edits'), 'last_commit_id' => pipeline_sha}
lookups = []
get = lambda do |route|
  parsed = URI.parse('https://gitlab.test/' + route)
  assert(URI.decode_www_form(parsed.query).to_h.fetch('ref') == pipeline_sha, 'proof inspected default branch instead of actual MR pipeline commit')
  path = URI.decode_www_form_component(parsed.path.split('/repository/files/').last)
  lookups << path
  repo.fetch(path)
end
verify = -> { WizardEnvironmentProof.files!(get, 'projects/1/', pipeline_sha, managed, activation) }
verify.call
assert(lookups == managed.map { |file| file.fetch('path') } && !lookups.include?('src/App.tsx'))
managed.each do |file|
  name = file.fetch('path'); original = repo.fetch(name).dup
  # A passing CI job may forge all artifact booleans. Managed source proof must
  # reject its edited producer before any such artifact can authorize deploy.
  repo[name] = {'content' => Base64.strict_encode64('forged success evidence'), 'last_commit_id' => pipeline_sha}
  begin
    verify.call
    raise 'Edited managed MR recipe was accepted'
  rescue RuntimeError => error
    raise unless error.message == 'managed-file-content'
  end
  # Editing and restoring bytes still changes file identity and must fail.
  repo[name] = original.merge('last_commit_id' => pipeline_sha)
  begin
    verify.call
    raise 'Recommitted managed MR recipe was accepted'
  rescue RuntimeError => error
    raise unless error.message == 'managed-file-content'
  end
  repo[name] = original
end
verify.call
puts 'Environment candidate proof: actual pipeline SHA, all preserved build scripts/Dockerfiles/Phase B marker, original activation identity, edited/restored recipe refusal and editable application source passed.'

native_files = ['.gitlab/primary.yml', '.gitlab/delivery/environment.sh'].map do |name|
  {'path' => name, 'sha256' => Digest::SHA256.hexdigest(name)}
end
native_files.each { |row| repo[row.fetch('path')] = {'content' => Base64.strict_encode64(row.fetch('path'))} }
native_project = {'id' => 5, 'path_with_namespace' => 'group/wizard', 'default_branch' => 'master', 'namespace' => {'id' => 3},
  'visibility' => 'private', 'ci_config_path' => '.gitlab/primary.yml', 'only_allow_merge_if_pipeline_succeeds' => true,
  'only_allow_merge_if_all_discussions_are_resolved' => true}
native_repository = {'id' => 5, 'path' => 'group/wizard', 'defaultBranch' => 'master', 'namespaceId' => 3,
  'managementMode' => 'source-primary', 'ciPath' => '.gitlab/primary.yml'}
native_binding = {'version' => 1, 'adoptionCommit' => activation, 'ciFiles' => native_files}
native_environment = {'managementMode' => 'source-primary', 'activationCommit' => activation, 'ciFiles' => native_files}
verify_native = lambda do
  WizardEnvironmentProof.source_primary!(get, 'projects/5/', native_repository, native_binding, native_environment, native_project, pipeline_sha)
end
verify_native.call
native_project['ci_config_path'] = '.system-bootstrapper/ci.yml'
begin; verify_native.call; raise 'Old CI accepted'; rescue RuntimeError => error; raise unless error.message == 'source-primary-ownership'; end
native_project['ci_config_path'] = '.gitlab/primary.yml'
native_project['only_allow_merge_if_pipeline_succeeds'] = false
begin; verify_native.call; raise 'Disabled gate accepted'; rescue RuntimeError => error; raise unless error.message == 'source-primary-ownership'; end
native_project['only_allow_merge_if_pipeline_succeeds'] = true
repo['.gitlab/delivery/environment.sh'] = {'content' => Base64.strict_encode64('edited helper invocation')}
begin; verify_native.call; raise 'Edited launcher accepted'; rescue RuntimeError => error; raise unless error.message == 'source-primary-content'; end
repo['.gitlab/delivery/environment.sh'] = {'content' => Base64.strict_encode64('.gitlab/delivery/environment.sh')}
verify_native.call
puts 'Source-primary environment proof: exact canonical namespace, selected CI, preserved merge gates and pipeline-commit CI bytes passed.'

require_relative '../../project-bootstrap/wizard-environments/source-primary-activate'
class NativeEnvironmentVariablesFixture
  attr_reader :mutations, :variables
  attr_accessor :lose_response
  def initialize(files, head, variables)
    @files, @head, @variables, @mutations = files, head, variables, []
  end
  def call(method, route, body = nil)
    if method == Net::HTTP::Get
      return [200, {'commit' => {'id' => @head}}] if route.include?('/repository/branches/')
      if route.include?('/repository/files/')
        name = URI.decode_www_form_component(route.split('/files/').last.split('?').first)
        return [200, @files.fetch(name)]
      end
      if route.include?('/variables/')
        name = route.split('/variables/').last.split('?').first
        return [200, @variables.fetch(name)]
      end
    elsif method == Net::HTTP::Put && route.include?('/variables/')
      name = route.split('/variables/').last.split('?').first
      @mutations << name
      @variables[name] = @variables.fetch(name).merge(body.to_h.transform_keys(&:to_s))
      if @lose_response
        @lose_response = false
        raise 'Applied write with lost response'
      end
      return [200, @variables.fetch(name)]
    end
    raise 'Unexpected native environment mutation'
  end
end
previous_environment = {'version' => 1, 'managementMode' => 'source-primary', 'operation' => '1' * 48,
  'helperImage' => 'sha256:' + '2' * 64, 'activationCommit' => activation, 'ciFiles' => native_files,
  'settings' => {'review' => {'enabled' => true, 'host' => 'review.example.test'}, 'beta' => {'enabled' => false, 'host' => ''}},
  'deployments' => {'review' => {'lastPipelineId' => 43, 'stoppedThroughPipelineId' => 43}}}
next_environment = JSON.parse(JSON.generate(previous_environment))
next_environment['operation'] = '3' * 48
next_environment['controller'] = 'system_bootstrapper_1'
next_environment['settings']['review']['host'] = 'new-review.example.test'
values = {'SYSTEM_WIZARD_ENVIRONMENT_IMAGE' => previous_environment.fetch('helperImage'),
  'SYSTEM_WIZARD_ENVIRONMENT_OPERATION' => previous_environment.fetch('operation'),
  'WIZARD_REVIEW_HOST' => 'review.example.test', 'WIZARD_BETA_HOST' => ''}
variables = values.to_h { |key, value| [key, {'key' => key, 'value' => value, 'environment_scope' => '*',
  'variable_type' => 'env_var', 'protected' => false, 'masked' => false, 'raw' => true}] }
fixture = NativeEnvironmentVariablesFixture.new(repo, pipeline_sha, variables)
native_input = {'action' => 'wizard-environments-primary', 'repository' => native_repository, 'sourcePrimary' => native_binding,
  'environments' => next_environment, 'previousEnvironments' => previous_environment, 'controller' => 'system_bootstrapper_1'}
native_run = -> { WizardSourcePrimaryEnvironments.new(fixture.method(:call), native_input, native_project).call }
fixture.lose_response = true
assert(native_run.call[:environments]['phase'] == 'pending')
assert(fixture.mutations == ['SYSTEM_WIZARD_ENVIRONMENT_OPERATION'])
native_input['action'] = 'wizard-environments-primary-status'
assert(native_run.call[:environments]['phase'] == 'pending')
assert(fixture.mutations.length == 1, 'Status mutated a partially applied variable transaction')
native_input['action'] = 'wizard-environments-primary'
assert(native_run.call[:environments]['phase'] == 'ready')
assert(fixture.mutations == ['SYSTEM_WIZARD_ENVIRONMENT_OPERATION', 'WIZARD_REVIEW_HOST'])
assert(next_environment['deployments'] == previous_environment['deployments'], 'Settings update lost generation floors')
native_input['action'] = 'wizard-environments-primary-status'
assert(native_run.call[:environments]['phase'] == 'ready' && fixture.mutations.length == 2)
fixture.variables['WIZARD_REVIEW_HOST']['value'] = 'foreign.example.test'
assert(native_run.call[:environments]['phase'] == 'requires-reconciliation')
assert(fixture.mutations.length == 2, 'Unexpected variable value was overwritten')
puts 'Source-primary environment settings: owned variables only, preserved floors, lost-response reconciliation, read-only status and foreign-value refusal passed.'

native_pipeline = {'id' => 99, 'sha' => pipeline_sha, 'status' => 'running'}
native_jobs = ['build:source', 'test:browser', 'build:wizard', 'test:wizard'].each_with_index.map do |name, index|
  {'id' => index + 101, 'project_id' => 5, 'name' => name, 'allow_failure' => false, 'status' => 'success',
    'commit' => {'id' => pipeline_sha}, 'pipeline' => {'id' => 99}}
end
verify_jobs = -> { WizardEnvironmentProof.native_jobs!(native_jobs, native_pipeline, 5) }
assert(verify_jobs.call.map { |row| row['name'] } == ['build:wizard', 'test:wizard'])
mirror_job = {'id' => 105, 'project_id' => 5, 'name' => 'deploy:github', 'allow_failure' => false,
  'status' => 'failed', 'commit' => {'id' => pipeline_sha}, 'pipeline' => {'id' => 99}}
native_jobs << mirror_job
native_pipeline['status'] = 'failed'
verify_jobs.call
%w[failed canceled skipped pending].each do |state|
  native_jobs[0]['status'] = state
  begin; verify_jobs.call; raise 'Failed native required check accepted'; rescue RuntimeError => error; raise unless error.message == 'native-required-jobs'; end
end
native_jobs[0]['status'] = 'success'
mirror_job['allow_failure'] = true
begin; verify_jobs.call; raise 'Optional fake mirror accepted'; rescue RuntimeError => error; raise unless error.message == 'native-publisher'; end
mirror_job['allow_failure'] = false
mirror_job['commit']['id'] = '0' * 40
begin; verify_jobs.call; raise 'Wrong-SHA mirror accepted'; rescue RuntimeError => error; raise unless error.message == 'native-publisher'; end
mirror_job['commit']['id'] = pipeline_sha
native_jobs << mirror_job.dup
begin; verify_jobs.call; raise 'Duplicate mirror accepted'; rescue RuntimeError => error; raise unless error.message == 'native-publisher'; end
native_jobs.pop
mirror_job['status'] = 'success'
native_pipeline['status'] = 'canceled'
begin; verify_jobs.call; raise 'Canceled pipeline accepted'; rescue RuntimeError => error; raise unless error.message == 'native-pipeline'; end
mirror_job['status'] = 'failed'
%w[pending running canceled].each do |state|
  mirror_job['status'] = state
  native_pipeline['status'] = state
  verify_jobs.call
end
mirror_job['status'] = 'failed'
native_pipeline['status'] = 'failed'
native_jobs << {'id' => 106, 'project_id' => 5, 'name' => 'additional-native-check', 'allow_failure' => false,
  'status' => 'failed', 'commit' => {'id' => pipeline_sha}, 'pipeline' => {'id' => 99}}
begin; verify_jobs.call; raise 'Unrelated check failure accepted'; rescue RuntimeError => error; raise unless error.message == 'native-other-job'; end
puts 'Source-primary deployment jobs: all native gates required, publisher-only failure accepted, false publisher/duplicate/wrong-SHA/canceled/native failures rejected.'
