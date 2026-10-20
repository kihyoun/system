require 'json'
require 'base64'
require 'digest'
require 'date'
require 'net/http'
require 'uri'
require 'stringio'
class BootstrapError < StandardError; end
load File.expand_path('../../project-bootstrap/wizard-source-primary/status.rb', __dir__)
sha = 'a' * 40; image = 'registry.example.test/team/system-wizard@sha256:' + 'b' * 64
ci = "# native source CI\n"
repository = {'id' => 7, 'namespaceId' => 9, 'path' => 'team/system-wizard', 'defaultBranch' => 'master',
  'managementMode' => 'source-primary', 'ciPath' => '.gitlab/primary.yml'}
input = {'repository' => repository, 'namespaceId' => 9, 'projectKey' => 'wizard', 'action' => 'wizard-source-primary-status',
  'sourcePrimary' => {'version' => 1, 'ciFiles' => [{'path' => '.gitlab/primary.yml', 'sha256' => Digest::SHA256.hexdigest(ci)}]},
  'build' => {'recipeHash' => 'c' * 64}, 'registryPrefix' => 'registry.example.test/team/system-wizard'}
project = {'id' => 7, 'path_with_namespace' => repository['path'], 'namespace' => {'id' => 9}, 'default_branch' => 'master',
  'visibility' => 'private', 'ci_config_path' => '.gitlab/primary.yml', 'only_allow_merge_if_pipeline_succeeds' => true,
  'only_allow_merge_if_all_discussions_are_resolved' => true}
pipeline = {'id' => 31, 'sha' => sha, 'source' => 'push', 'status' => 'success', 'ref' => 'master'}
artifact = {'version' => 1, 'sourceCommit' => sha, 'pipelineId' => 31, 'imageRef' => image}
baseline = {
  'namespaces/9' => {'id' => 9, 'full_path' => 'team'}, 'projects/7' => project,
  'projects/7/repository/branches/master' => {'commit' => {'id' => sha}},
  "projects/7/pipelines?ref=master&sha=#{sha}&source=push&per_page=100" => [pipeline],
  "projects/7/repository/files/.gitlab%2Fprimary.yml?ref=#{sha}" => {'content' => Base64.strict_encode64(ci)},
  'projects/7/pipelines/31/jobs?per_page=100&include_retried=false' => ['build:wizard', 'test:wizard', 'build:source', 'test:browser'].each_with_index.map { |name, i|
    {'id' => 40 + i, 'name' => name, 'status' => 'success', 'allow_failure' => false, 'commit' => {'id' => sha}, 'pipeline' => {'id' => 31}} },
  'projects/7/jobs/40/artifacts/build-evidence.json' => artifact.merge('testRunner' => 'vitest', 'unitTests' => true, 'lint' => true, 'typecheck' => true, 'productionBuild' => true),
  'projects/7/jobs/41/artifacts/wizard-evidence.json' => artifact.merge(['http', 'renderedUI', 'projects', 'spa', 'configurationBackup', 'cubeSignature'].to_h { |key| [key, true] })
}
run = lambda do |change = nil|
  rows = Marshal.load(Marshal.dump(baseline)); change.call(rows) if change
  calls = []
  api = lambda do |method, route, *_|
    raise 'status mutated GitLab' unless method == Net::HTTP::Get
    calls << route
    [200, rows.fetch(route)]
  end
  WizardSourcePrimaryStatus.new(api, input, rows.fetch('projects/7')).call
end
raise 'native build status rejected' unless run.call[:build]['phase'] == 'candidate-verified'
pending = run.call(->(rows) { rows["projects/7/pipelines?ref=master&sha=#{sha}&source=push&per_page=100"][0]['status'] = 'running' })
raise 'pending default head reused stale artifact' unless pending[:build]['phase'] == 'pending' && !pending[:build].key?('artifact')
[
  ->(rows) { rows['projects/7']['namespace']['id'] = 8 },
  ->(rows) { rows['projects/7']['only_allow_merge_if_pipeline_succeeds'] = false },
  ->(rows) { rows["projects/7/repository/files/.gitlab%2Fprimary.yml?ref=#{sha}"]['content'] = Base64.strict_encode64('edited') },
  ->(rows) { rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'][0]['allow_failure'] = true },
  ->(rows) { rows['projects/7/jobs/40/artifacts/build-evidence.json']['imageRef'] = image.sub('registry.example.test', 'foreign.example.test') },
  ->(rows) { rows['projects/7/jobs/41/artifacts/wizard-evidence.json']['cubeSignature'] = false },
  ->(rows) { rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'][2]['status'] = 'failed' }
].each do |change|
  begin
    run.call(change)
  rescue BootstrapError
    next
  end
  raise 'invalid native status accepted'
end
mirror_failed = run.call(->(rows) {
  rows["projects/7/pipelines?ref=master&sha=#{sha}&source=push&per_page=100"][0]['status'] = 'failed'
  rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'] << {'id' => 44, 'name' => 'deploy:github',
    'status' => 'failed', 'allow_failure' => false, 'commit' => {'id' => sha}, 'pipeline' => {'id' => 31}}
})
raise 'mirror outage hid passing native status' unless mirror_failed[:build]['publishing']['mirrorFailed'] == true
['pending', 'running', 'canceled'].each do |status|
  result = run.call(->(rows) {
    rows["projects/7/pipelines?ref=master&sha=#{sha}&source=push&per_page=100"][0]['status'] = status
    rows['projects/7/pipelines/31/jobs?per_page=100&include_retried=false'] << {'id' => 44, 'name' => 'deploy:github',
      'status' => status, 'allow_failure' => false, 'commit' => {'id' => sha}, 'pipeline' => {'id' => 31}}
  })
  raise 'mirror state hid verified native status' unless result[:build]['phase'] == 'candidate-verified' && result[:build]['publishing']['status'] == status
end

# Exercise the real provisioning lookup: an adopted source repository does not
# have to share its path with the internal Project Key "wizard".
def Date.tomorrow = today + 1
class NativeFixtureToken
  def token = 'offline-fixture-token'
  def revoke! = $native_revoked += 1
end
class NativeFixtureTokens
  def where(*) = self
  def find_each; end
  def create!(**) = NativeFixtureToken.new
end
class NativeFixtureAdmin
  def admin? = true
  def active? = true
  def personal_access_tokens = NativeFixtureTokens.new
end
class User
  def self.find_by_username(*) = NativeFixtureAdmin.new
end
module Net
  class HTTP
    def self.start(*) = yield(new('offline.example.test'))
    def request(request)
      raise 'provision status made a write' unless request.is_a?(Net::HTTP::Get)
      route = request.path.delete_prefix('/api/v4/')
      $native_routes << route
      Struct.new(:code, :body).new('200', JSON.generate($native_rows.fetch(route)))
    end
  end
end
$native_rows = Marshal.load(Marshal.dump(baseline)); $native_routes = []; $native_revoked = 0
BOOTSTRAPPER_INPUT = Base64.strict_encode64(JSON.generate(input))
previous = $stdout; $stdout = StringIO.new
begin
  load File.expand_path('../../project-bootstrap/provision.rb', __dir__)
  result = JSON.parse($stdout.string)
ensure
  $stdout = previous
end
raise 'bound project lookup did not preserve custom source path' unless result.dig('build', 'phase') == 'candidate-verified' &&
  $native_routes.include?('projects/7') && $native_routes.none? { |route| route.include?('team%2Fwizard') } && $native_revoked == 1
puts 'Native Wizard status: bound ID/custom path, namespace/gates/CI/artifacts, read-only pending state, mirror isolation and credential cleanup passed.'
