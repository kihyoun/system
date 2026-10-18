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
