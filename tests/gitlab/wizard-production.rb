require 'json'
require 'base64'
require 'date'
require 'net/http'
require 'uri'
require 'stringio'
def Date.tomorrow = today + 1
class ProductionToken
  def token = 'offline-fixture-only'
  def revoke! = $revoked += 1
end
class ProductionTokens
  def create!(**options)
    raise 'scope' unless options[:scopes] == ['api'] && options[:expires_at] == Date.tomorrow
    $created += 1
    ProductionToken.new
  end
end
class ProductionAdmin
  def admin? = true
  def active? = true
  def personal_access_tokens = ProductionTokens.new
end
class User
  def self.find_by_username(name)
    raise 'username' unless name == 'root'
    ProductionAdmin.new
  end
end
module Net
  class HTTP
    def self.start(*)
      yield new('offline.example.test')
    end
    def request(request)
      key = request.path.delete_prefix('/api/v4/')
      value = $responses.fetch(key)
      Struct.new(:code, :body).new('200', JSON.generate(value))
    end
  end
end
proof = {'version' => 1, 'projectId' => 3, 'projectPath' => 'root/wizard', 'pipelineId' => 21,
  'sourceCommit' => 'd' * 40, 'imageRef' => 'registry.example.test/root/wizard@sha256:' + 'c' * 64,
  'productionHost' => 'system-bootstrapper.com'}
WIZARD_PRODUCTION_PROOF = Base64.strict_encode64(JSON.generate(proof))
base_artifact = {'version' => 1, 'sourceCommit' => proof['sourceCommit'], 'pipelineId' => 21, 'imageRef' => proof['imageRef']}
baseline = {
  'projects/3' => {'visibility' => 'private', 'path_with_namespace' => 'root/wizard', 'ci_config_path' => '.system-bootstrapper/ci.yml'},
  'projects/3/pipelines/21' => {'id' => 21, 'sha' => proof['sourceCommit'], 'status' => 'success'},
  'projects/3/pipelines/21/jobs?per_page=100&include_retried=false' => ['build:wizard', 'test:wizard'].each_with_index.map { |name, i|
    {'id' => 41 + i, 'name' => name, 'status' => 'success', 'allow_failure' => false, 'commit' => {'id' => proof['sourceCommit']}} },
  'projects/3/jobs/41/artifacts/build-evidence.json' => base_artifact.merge('unitTests' => true, 'testRunner' => 'vitest', 'lint' => true, 'typecheck' => true, 'productionBuild' => true),
  'projects/3/jobs/42/artifacts/wizard-evidence.json' => base_artifact.merge(['http', 'renderedUI', 'projects', 'spa', 'configurationBackup', 'cubeSignature'].to_h { |key| [key, true] })
}
run = lambda do |change, binding = nil|
  $responses = Marshal.load(Marshal.dump(baseline)); change.call($responses) if change
  Object.send(:remove_const, :WIZARD_PRODUCTION_BINDING) if Object.const_defined?(:WIZARD_PRODUCTION_BINDING)
  Object.const_set(:WIZARD_PRODUCTION_BINDING, Base64.strict_encode64(JSON.generate(binding)))
  $created = $revoked = 0
  previous = $stdout; $stdout = StringIO.new
  begin
    load File.expand_path('../../project-bootstrap/wizard-production/verify.rb', __dir__)
    output = JSON.parse($stdout.string)
  ensure
    $stdout = previous
  end
  raise 'temporary credential leak' unless $created == 1 && $revoked == 1
  output.fetch('ok')
end
raise 'valid proof rejected' unless run.call(nil)
changes = [
  ->(rows) { rows['projects/3']['visibility'] = 'public' },
  ->(rows) { rows['projects/3/pipelines/21']['status'] = 'failed' },
  ->(rows) { rows['projects/3/pipelines/21']['sha'] = 'e' * 40 },
  ->(rows) { rows['projects/3/pipelines/21/jobs?per_page=100&include_retried=false'][0]['allow_failure'] = true },
  ->(rows) { rows['projects/3/jobs/41/artifacts/build-evidence.json']['imageRef'] = 'other-image' },
  ->(rows) { rows['projects/3/jobs/41/artifacts/build-evidence.json']['lint'] = false },
  ->(rows) { rows['projects/3/jobs/42/artifacts/wizard-evidence.json']['configurationBackup'] = false },
  ->(rows) { rows['projects/3/jobs/42/artifacts/wizard-evidence.json']['cubeSignature'] = false }
]
changes.each { |change| raise 'invalid production proof accepted' if run.call(change) }
ci = "# reviewed native CI\n"
binding = {'namespaceId' => 8, 'repository' => {'id' => 3, 'namespaceId' => 8, 'path' => 'root/wizard', 'defaultBranch' => 'master',
  'managementMode' => 'source-primary', 'ciPath' => '.gitlab/primary.yml'},
  'sourcePrimary' => {'version' => 1, 'ciFiles' => [{'path' => '.gitlab/primary.yml', 'sha256' => Digest::SHA256.hexdigest(ci)}]}}
native = lambda do |rows|
  rows['projects/3'].merge!('namespace' => {'id' => 8}, 'default_branch' => 'master', 'ci_config_path' => '.gitlab/primary.yml',
    'only_allow_merge_if_pipeline_succeeds' => true, 'only_allow_merge_if_all_discussions_are_resolved' => true)
  rows['projects/3/pipelines/21'].merge!('source' => 'push', 'ref' => 'master')
  rows['projects/3/repository/branches/master'] = {'commit' => {'id' => proof['sourceCommit']}}
  rows['projects/3/repository/files/.gitlab%2Fprimary.yml?ref=' + proof['sourceCommit']] = {'content' => Base64.strict_encode64(ci)}
  jobs = rows['projects/3/pipelines/21/jobs?per_page=100&include_retried=false']
  jobs.each { |job| job['pipeline'] = {'id' => 21} }
  ['build:source', 'test:browser'].each_with_index do |name, index|
    jobs << {'id' => 50 + index, 'name' => name, 'status' => 'success', 'allow_failure' => false,
      'commit' => {'id' => proof['sourceCommit']}, 'pipeline' => {'id' => 21}}
  end
end
raise 'canonical source-primary proof rejected' unless run.call(native, binding)
raise 'unbound source-primary project accepted' if run.call(native)
[
  ->(rows) { rows['projects/3']['namespace']['id'] = 9 },
  ->(rows) { rows['projects/3']['only_allow_merge_if_pipeline_succeeds'] = false },
  ->(rows) { rows['projects/3']['only_allow_merge_if_all_discussions_are_resolved'] = false },
  ->(rows) { rows['projects/3/pipelines/21']['source'] = 'api' },
  ->(rows) { rows['projects/3/pipelines/21']['status'] = 'failed' },
  ->(rows) { rows['projects/3/pipelines/21']['status'] = 'canceled' },
  ->(rows) { rows['projects/3/pipelines/21/jobs?per_page=100&include_retried=false'].find { |j| j['name'] == 'build:source' }['status'] = 'failed' },
  ->(rows) { rows['projects/3/pipelines/21/jobs?per_page=100&include_retried=false'].find { |j| j['name'] == 'test:browser' }['status'] = 'skipped' },
  ->(rows) { rows['projects/3/repository/branches/master']['commit']['id'] = 'e' * 40 },
  ->(rows) { rows['projects/3/repository/files/.gitlab%2Fprimary.yml?ref=' + proof['sourceCommit']]['content'] = Base64.strict_encode64('edited CI') }
].each do |change|
  raise 'invalid source-primary proof accepted' if run.call(->(rows) { native.call(rows); change.call(rows) }, binding)
end
mirror_failure = lambda do |rows|
  native.call(rows); rows['projects/3/pipelines/21']['status'] = 'failed'
  rows['projects/3/pipelines/21/jobs?per_page=100&include_retried=false'] << {'id' => 60, 'name' => 'deploy:github',
    'status' => 'failed', 'allow_failure' => false, 'commit' => {'id' => proof['sourceCommit']}, 'pipeline' => {'id' => 21}}
end
raise 'public mirror failure incorrectly blocked native delivery' unless run.call(mirror_failure, binding)
['pending', 'running', 'canceled'].each do |status|
  raise 'public mirror state incorrectly blocked native delivery' unless run.call(->(rows) {
    mirror_failure.call(rows); rows['projects/3/pipelines/21']['status'] = status
    rows['projects/3/pipelines/21/jobs?per_page=100&include_retried=false'].last['status'] = status
  }, binding)
end
raise 'fake mirror failure bypassed native proof' if run.call(->(rows) {
  mirror_failure.call(rows); rows['projects/3/pipelines/21/jobs?per_page=100&include_retried=false'].last['name'] = 'fake:mirror'
}, binding)
wrong = Marshal.load(Marshal.dump(binding)); wrong['repository']['id'] = 99
raise 'foreign source-primary project accepted' if run.call(native, wrong)
puts 'Production proof: private project, exact pipeline/source/digest, required successful jobs, backup/Cube gates and temporary-token revocation passed.'
