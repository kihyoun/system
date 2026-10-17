require 'json'
require 'base64'
require 'digest'
require 'net/http'
require 'uri'
class BootstrapError < StandardError; end
require_relative '../../project-bootstrap/wizard-build/activate'
def assert(value, message = 'assertion failed')
  raise message unless value
end
def rejects(message)
  begin
    yield
  rescue BootstrapError => error
    assert(error.message.include?(message), error.message)
    return
  end
  raise 'Expected rejection: ' + message
end
class LeasePool
  attr_accessor :busy
  def with_connection
    yield self
  end
  def select_value(sql)
    return false if sql.include?('pg_try') && @busy
    true
  end
end
module ActiveRecord
  class Base
    def self.connection_pool
      @pool ||= LeasePool.new
    end
  end
end
class BuildFixture
  attr_accessor :fail_after_commit, :fail_after_pipeline, :fail_after_intent, :hide_pipelines, :source_race, :pipeline_race, :status, :intent, :artifact_override, :job_override
  attr_reader :files, :commits, :pipelines, :posts
  def initialize(input)
    @input = input
    @head = 'a' * 40
    @commits, @posts = 0, 0
    @status = 'running'
    @pipelines = []
    @files = {'.system-bootstrapper/ci.yml' => row('disabled', @head),
      '.gitlab-ci.yml' => row('upstream publishing unchanged', @head),
      'README.md' => row('existing README', @head),
      '.system-bootstrapper/wizard-source.json' => row(JSON.generate({version: 1, operation: 'registration', sourceRevision: 'c' * 40, manifestHash: 'f' * 64}), @head)}
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
        return [200, {'parent_ids' => [@source_race ? 'e' * 40 : 'a' * 40]}]
      elsif route.include?('/pipelines?')
        return [200, @hide_pipelines ? [] : @pipelines.map { |row| row.merge('status' => @status) }]
      elsif route.include?('/variables/')
        return @intent ? [200, @intent] : [404, {}]
      elsif route.end_with?('/variables')
        return [200, [{'key' => 'SYSTEM_WIZARD_OPERATION', 'value' => @input.fetch('build').fetch('operation')}]]
      elsif route.include?('/jobs?')
        return [200, @job_override || [{'id' => 10, 'name' => 'build:wizard', 'status' => 'success', 'allow_failure' => false},
          {'id' => 20, 'name' => 'test:wizard', 'status' => 'success', 'allow_failure' => false}]]
      elsif route.include?('/artifacts/')
        data = {'version' => 1, 'sourceCommit' => 'b' * 40, 'pipelineId' => 11,
          'imageRef' => 'registry.localhost:5050/root/wizard@sha256:' + 'd' * 64,
          'jest' => true, 'productionBuild' => true, 'http' => true, 'renderedUI' => true, 'projects' => true, 'spa' => true}
        data['renderedUI'] = false if @status == 'bad-artifact'
        data.merge!(@artifact_override) if @artifact_override
        return [200, data]
      elsif route.match?(%r{/pipelines/\d+\z})
        return [200, @pipelines.first.merge('status' => @status == 'bad-artifact' ? 'success' : @status)]
      end
    elsif method == Net::HTTP::Post && route.end_with?('/repository/commits')
      candidate = Marshal.load(Marshal.dump(@files))
      body.fetch(:actions).each do |action|
        name = action.fetch(:file_path)
        if action.fetch(:action) == 'create'
          return [400, {}] if candidate.key?(name)
        else
          return [400, {}] unless candidate.fetch(name).fetch('last_commit_id') == action.fetch(:last_commit_id)
        end
        candidate[name] = row(action.fetch(:content), 'b' * 40)
      end
      assert(body.fetch(:commit_message).include?('[skip ci]'))
      @files = candidate; @commits += 1; @head = 'b' * 40
      raise BootstrapError, 'interrupted commit' if @fail_after_commit
      return [201, {'id' => @head}]
    elsif method == Net::HTTP::Post && route.end_with?('/variables')
      return [400, {}] if @intent
      @intent = JSON.parse(JSON.generate(body))
      raise BootstrapError, 'interrupted intent' if @fail_after_intent
      return [201, @intent]
    elsif method == Net::HTTP::Post && route.end_with?('/pipeline')
      @posts += 1
      pipeline = {'id' => 11, 'sha' => @pipeline_race ? 'e' * 40 : @head,
        'source' => 'api', 'ref' => 'main', 'status' => @status, 'web_url' => 'http://gitlab.localhost/pipeline/11'}
      @pipelines << pipeline
      raise BootstrapError, 'interrupted pipeline' if @fail_after_pipeline
      return [201, pipeline]
    end
    raise 'Unexpected fixture request: ' + route
  end
end
input = {'action' => 'wizard-build', 'operation' => 'registration', 'repository' => {'id' => 1, 'path' => 'root/wizard', 'defaultBranch' => 'main'},
  'workflow' => {'importCommit' => 'a' * 40, 'sourceRevision' => 'c' * 40, 'manifestHash' => 'f' * 64},
  'build' => {'version' => 1, 'operation' => 'd' * 48, 'recipeHash' => 'recipe'}, 'expectedCi' => 'disabled',
  'recipe' => {'version' => 1, 'recipeHash' => 'recipe', 'ci' => 'managed no-deploy CI',
    'files' => [{'path' => '.system-bootstrapper/build-v1/check.sh', 'content' => 'checks'}]}, 'registryPrefix' => 'registry.localhost:5050/root/wizard'}
project = {'id' => 1, 'description' => 'System Bootstrapper operation registration', 'visibility' => 'private',
  'path_with_namespace' => 'root/wizard', 'default_branch' => 'main', 'ci_config_path' => '.system-bootstrapper/ci.yml'}
fixture = BuildFixture.new(input)
run = -> { WizardBuildActivation.new(fixture.method(:call), input, project).call }
assert(run.call[:build]['phase'] == 'pipeline-running')
assert(fixture.commits == 1 && fixture.posts == 1)
assert(run.call[:build]['pipeline'][:id] == 11 && fixture.posts == 1)
fixture.status = 'success'
result = run.call[:build]
assert(result['phase'] == 'candidate-verified' && result['artifact'][:sourceCommit] == 'b' * 40)
assert(Base64.decode64(fixture.files.fetch('.gitlab-ci.yml').fetch('content')) == 'upstream publishing unchanged')
assert(Base64.decode64(fixture.files.fetch('README.md').fetch('content')) == 'existing README')
input['build'] = JSON.parse(JSON.generate(result))
fixture.status = 'bad-artifact'
rejects('incomplete') { run.call }
fixture.status = 'success'
[
  {'sourceCommit' => 'e' * 40}, {'pipelineId' => 999},
  {'imageRef' => 'other-registry/root/wizard@sha256:' + 'd' * 64},
  {'imageRef' => 'registry.localhost:5050/root/wizard@sha256:short'}
].each do |changed|
  fixture.artifact_override = changed
  rejects('identity or digest') { run.call }
end
fixture.artifact_override = {'jest' => false}
rejects('incomplete') { run.call }
fixture.artifact_override = nil
fixture.job_override = [{'id' => 10, 'name' => 'build:wizard', 'status' => 'success', 'allow_failure' => true}]
rejects('required checks') { run.call }
fixture.job_override = nil
input['build'] = {'version' => 1, 'operation' => 'd' * 48, 'recipeHash' => 'recipe'}
fixture = BuildFixture.new(input); fixture.fail_after_commit = true
rejects('interrupted commit') { run.call }
fixture.fail_after_commit = false
input['action'] = 'wizard-build-status'
assert(run.call[:build]['phase'] == 'recipe-installed' && fixture.posts == 0)
input['action'] = 'wizard-build'
assert(run.call[:build]['pipeline'][:id] == 11 && fixture.commits == 1 && fixture.posts == 1)
fixture = BuildFixture.new(input); fixture.fail_after_intent = true
rejects('interrupted intent') { run.call }; fixture.fail_after_intent = false
assert(run.call[:build]['phase'] == 'requires-reconciliation' && fixture.posts == 0)
assert(run.call[:build]['phase'] == 'requires-reconciliation' && fixture.posts == 0, 'Intent-before-POST retry created a pipeline')
fixture = BuildFixture.new(input); fixture.fail_after_pipeline = true; fixture.hide_pipelines = true
assert(run.call[:build]['phase'] == 'requires-reconciliation'); fixture.fail_after_pipeline = false
assert(run.call[:build]['phase'] == 'requires-reconciliation' && fixture.posts == 1, 'Uncertain external request was duplicated')
fixture.hide_pipelines = false
assert(run.call[:build]['pipeline'][:id] == 11 && fixture.posts == 1)
fixture.intent['value'] = 'changed'
rejects('checkpoint changed') { run.call }
fixture = BuildFixture.new(input)
run.call
fixture.files['.system-bootstrapper/ci.yml'] = fixture.row('maintainer edit', 'edited')
rejects('Managed Wizard CI changed') { run.call }; assert(fixture.commits == 1 && fixture.posts == 1)
fixture = BuildFixture.new(input); fixture.source_race = true
rejects('source raced') { run.call }; assert(fixture.posts == 0)
fixture = BuildFixture.new(input); fixture.pipeline_race = true
rejects('raced pipeline') { run.call }
fixture.pipeline_race = false
rejects('identity changed') { run.call }; assert(fixture.posts == 1)
fixture = BuildFixture.new(input)
fixture.files['.system-bootstrapper/ci.yml'] = fixture.row('maintainer edit', 'edited')
rejects('scaffold changed') { run.call }; assert(fixture.commits == 0)
fixture = BuildFixture.new(input)
ActiveRecord::Base.connection_pool.busy = true
rejects('still running') { run.call }; assert(fixture.posts == 0)
ActiveRecord::Base.connection_pool.busy = false
%w[id visibility description path_with_namespace default_branch ci_config_path].each do |key|
  changed = project.merge(key => 'different')
  rejects('ownership changed') { WizardBuildActivation.new(fixture.method(:call), input, changed).call }
end
puts 'Wizard build: ownership/content/race guards, interrupted commit/pipeline recovery, no status mutation and verified artifact gates passed.'
