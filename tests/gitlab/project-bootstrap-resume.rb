require 'json'
require 'base64'
require 'date'
require 'stringio'
require 'net/http'
require 'uri'

def assert(value, message = 'assertion failed')
  raise message unless value
end

class Date
  def self.tomorrow = today + 1
end

class ProvisionCredential
  attr_reader :token
  attr_accessor :revoked
  def initialize
    @token, @revoked = 'synthetic-project-token', false
  end
  def revoke! = @revoked = true
end

class ProvisionTokens
  attr_reader :credential
  def where(*) = self
  def find_each; end
  def create!(**) = @credential = ProvisionCredential.new
end

class User
  def self.find_by_username(name)
    assert(name == 'root')
    @admin ||= new
  end
  def admin? = true
  def active? = true
  def personal_access_tokens = @tokens ||= ProvisionTokens.new
end

class ProvisionFixture
  attr_accessor :exists, :project
  attr_reader :files, :requests
  def initialize
    @exists = true
    @project = {'id' => 42, 'path_with_namespace' => 'team/application', 'namespace' => {'id' => 7},
      'visibility' => 'private', 'description' => 'System Bootstrapper operation owned-operation',
      'default_branch' => 'main', 'ci_config_path' => '.system-bootstrapper/ci.yml',
      'web_url' => 'https://gitlab.example.test/team/application'}
    @files = {'.system-bootstrapper/ci.yml' => 'user-edited CI with product checks',
      'src/app.ts' => 'user application source'}
    @requests = []
  end
  def request(request)
    route = request.path.delete_prefix('/api/v4/')
    body = request.body && JSON.parse(request.body)
    @requests << [request.method, route, body]
    code, data = case [request.method, route]
    when ['GET', 'namespaces/7'] then [200, {'id' => 7, 'full_path' => 'team'}]
    when ['GET', 'projects/team%2Fapplication'] then @exists ? [200, @project] : [404, {}]
    when ['POST', 'projects']
      @exists = true
      [201, @project]
    when ['PUT', 'projects/42']
      @project['ci_config_path'] = body.fetch('ci_config_path')
      [200, @project]
    when ['POST', 'projects/42/repository/commits']
      body.fetch('actions').each do |action|
        assert(action.fetch('action') == 'create')
        name = action.fetch('file_path')
        assert(!@files.key?(name), 'initial creation must not overwrite a file')
        @files[name] = action.fetch('content')
      end
      [201, {'id' => 'initial-commit'}]
    else
      if request.method == 'GET' && route.start_with?('projects/42/repository/files/')
        path, query = route.split('?', 2)
        assert(URI.decode_www_form(query).to_h.fetch('ref') == 'main')
        name = URI.decode_www_form_component(path.split('/files/', 2).last)
        @files.key?(name) ? [200, {'content' => Base64.strict_encode64(@files.fetch(name))}] : [404, {}]
      else
        raise 'unexpected fixture API request'
      end
    end
    Struct.new(:code, :body).new(code.to_s, JSON.generate(data))
  end
  def mutations = @requests.reject { |method,| method == 'GET' }
end

class << Net::HTTP
  attr_accessor :provision_fixture
  def start(host, port, **)
    assert(host == '127.0.0.1' && port == 80)
    yield provision_fixture
  end
end

def input
  {'action' => 'create', 'projectKey' => 'application', 'namespaceId' => '7', 'operation' => 'owned-operation',
    'template' => 'angular', 'templateVersion' => 1, 'ci' => 'original generated CI',
    'files' => [{'action' => 'create', 'file_path' => 'starter.ts', 'content' => 'initial starter'}]}
end

def repository_binding
  {'id' => 42, 'namespaceId' => 7, 'path' => 'team/application',
    'webUrl' => 'https://gitlab.example.test/team/application', 'defaultBranch' => 'main',
    'pipelineUrl' => 'https://gitlab.example.test/team/application/-/pipelines',
    'ciPath' => '.system-bootstrapper/ci.yml', 'template' => 'angular', 'templateVersion' => 1,
    'generatedCi' => 'original generated CI', 'deploymentState' => 'awaiting-pipeline'}
end

def invoke(fixture, payload)
  Net::HTTP.provision_fixture = fixture
  Object.send(:remove_const, :BOOTSTRAPPER_INPUT) if Object.const_defined?(:BOOTSTRAPPER_INPUT)
  Object.const_set(:BOOTSTRAPPER_INPUT, Base64.strict_encode64(JSON.generate(payload)))
  previous = $stdout
  $stdout = StringIO.new
  begin
    load File.expand_path('../../project-bootstrap/provision.rb', __dir__)
    JSON.parse($stdout.string)
  ensure
    $stdout = previous
    assert(User.find_by_username('root').personal_access_tokens.credential.revoked, 'temporary credential must be revoked')
  end
end

fixture = ProvisionFixture.new
before = Marshal.dump(fixture.files)
result = invoke(fixture, input.merge('resumeRepository' => repository_binding))
assert(result.fetch('repository') == repository_binding, 'resume must preserve original receipt metadata')
assert(fixture.mutations.empty?, 'routing recovery must not mutate the GitLab repository or settings')
assert(Marshal.dump(fixture.files) == before, 'edited CI and application source must survive')

[
  ->(f, _) { f.exists = false },
  ->(f, _) { f.project['id'] = 43 },
  ->(f, _) { f.project['path_with_namespace'] = 'other/application' },
  ->(f, _) { f.project['namespace']['id'] = 8 },
  ->(f, _) { f.project['visibility'] = 'public' },
  ->(f, _) { f.project['description'] = 'unrelated project' },
  ->(f, _) { f.project['default_branch'] = 'other' },
  ->(f, _) { f.project['ci_config_path'] = '.gitlab-ci.yml' },
  ->(f, _) { f.files.delete('.system-bootstrapper/ci.yml') },
  ->(_, b) { b['id'] = 0 },
  ->(_, b) { b['id'] = 42.5 },
  ->(_, b) { b['path'] = 'other/application' },
  ->(_, b) { b['namespaceId'] = 8 },
  ->(_, b) { b['namespaceId'] = 7.5 },
  ->(_, b) { b['defaultBranch'] = '' },
  ->(_, b) { b['ciPath'] = '.gitlab-ci.yml' }
].each do |change|
  fixture, bound = ProvisionFixture.new, repository_binding
  change.call(fixture, bound)
  before = Marshal.dump(fixture.files)
  result = invoke(fixture, input.merge('resumeRepository' => bound))
  assert(result['state'] == 'failed', 'changed/missing pending repository must refuse resume')
  assert(fixture.mutations.empty?, 'refused resume must not recreate or change a repository')
  assert(Marshal.dump(fixture.files) == before)
end

fixture = ProvisionFixture.new
result = invoke(fixture, input)
assert(result['state'] == 'failed' && result['message'].include?('Managed CI changed'))
assert(fixture.mutations.empty?, 'unbound creation must still reject edited CI')

fixture = ProvisionFixture.new
fixture.project['description'] = 'unrelated project'
result = invoke(fixture, input)
assert(result['conflict'] && fixture.mutations.empty?, 'initial creation must not adopt a foreign project')

fixture = ProvisionFixture.new
fixture.exists = false
fixture.files.delete('.system-bootstrapper/ci.yml')
result = invoke(fixture, input)
assert(result.fetch('repository').fetch('id') == 42)
assert(fixture.files.fetch('.system-bootstrapper/ci.yml') == input.fetch('ci'))
assert(fixture.files.fetch('starter.ts') == 'initial starter')
assert(fixture.mutations.map(&:first) == %w[POST POST PUT], 'initial creation must retain its native setup path')

puts 'Pending project routing recovery: edited CI/source preserved, exact binding required, missing/foreign repositories refused and initial creation guards retained.'
