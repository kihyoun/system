require 'json'
require 'base64'
require 'digest'
require 'stringio'
require_relative '../../project-bootstrap/system-review/verify'

def assert(value, message = 'assertion failed')
  raise message unless value
end
def image(char) = 'sha256:' + char * 64
def copy(value) = Marshal.load(Marshal.dump(value))
sha, wizard_sha = 'a' * 40, 'b' * 40
registry = 'registry.example.test/team/system'
environment = {'version' => 1, 'managementMode' => 'source-primary', 'phase' => 'ready', 'operation' => 'f' * 48,
  'helperImage' => image('0'), 'controller' => 'system_bootstrapper_1', 'activationCommit' => 'c' * 40,
  'settings' => {'review' => {'enabled' => true, 'host' => 'review.example.test', 'domainMode' => 2}},
  'settingsHash' => 'd' * 64, 'recipeHash' => 'e' * 64, 'ciFiles' => [], 'deployments' => {}}
binding = {'version' => 1, 'operation' => environment['operation'], 'projectId' => 4, 'projectPath' => 'team/system',
  'namespaceId' => 9, 'defaultBranch' => 'main', 'mrIid' => 2, 'pipelineId' => 10, 'sourceCommit' => sha,
  'helperImage' => image('1'), 'wizardImageId' => image('2'), 'wizardImageRef' => registry + '/successor-wizard@' + image('3'),
  'wizardRevision' => wizard_sha, 'candidateJobId' => 24, 'wizardProjectId' => 7, 'wizardProjectPath' => 'team/wizard',
  'wizardDefaultBranch' => 'master', 'environmentHash' => Digest::SHA256.hexdigest(JSON.generate(environment.reject { |key, _| key == 'deployments' }))}
input = {'binding' => binding, 'request' => {'action' => 'deploy', 'kind' => 'review', 'projectId' => 4, 'pipelineId' => 10,
  'jobId' => 90, 'sourceCommit' => sha, 'mrIid' => 2, 'operation' => environment['operation']}, 'environments' => environment,
  'repository' => {'id' => 7, 'path' => 'team/wizard', 'namespaceId' => 9, 'defaultBranch' => 'master'},
  'securityRelease' => JSON.parse(File.read(File.expand_path('../../gitlab/security-release.json', __dir__)))}
security = input.fetch('securityRelease')
project = {'id' => 4, 'path_with_namespace' => 'team/system', 'namespace' => {'id' => 9}, 'default_branch' => 'main',
  'visibility' => 'private', 'ci_config_path' => nil, 'only_allow_merge_if_pipeline_succeeds' => true,
  'only_allow_merge_if_all_discussions_are_resolved' => true, 'container_registry_image_prefix' => registry}
pipeline = {'id' => 10, 'sha' => sha, 'source' => 'merge_request_event', 'status' => 'running', 'project_id' => 4}
job = {'id' => 90, 'name' => 'deploy:wizard-review', 'status' => 'running', 'allow_failure' => true,
  'pipeline' => {'id' => 10}, 'commit' => {'id' => sha}, 'project_id' => 4}
jobs = SystemReviewProof::JOBS.each_with_index.map { |name, index|
  job.merge('id' => 20 + index, 'name' => name, 'status' => 'success', 'allow_failure' => false) } + [job]
proof = {'runId' => 'f' * 24, 'sourceRevision' => sha, 'fullAcceptance' => true,
  'images' => {'candidate' => image('1'), 'wizard' => image('2'), 'gitlab' => image('4'), 'runner' => image('5')},
  'results' => SystemReviewProof::STAGES.map { |name| {'name' => name, 'status' => 'passed'} },
  'evidence' => {'storage' => SystemReviewProof::STORAGE.to_h { |name| [name, true] },
    'gitlabUpgrade' => {'fromImage' => security['fromImage'], 'toImage' => security['toImage'],
      'fromImageId' => image('6'), 'toImageId' => image('4'), 'migrationVerified' => true,
      'rollbackVerified' => true, 'registryVerified' => true, 'checkpointVerified' => true,
      'runnerImage' => security['runner']['toImage'], 'runnerVersion' => security['runner']['toVersion'],
      'runnerImageId' => image('5'), 'fromRunnerImageId' => image('7'), 'helperImage' => security['runner']['helperImage'],
      'helperImageId' => image('8'), 'fromHelperImageId' => image('9'), 'securityTrustVerified' => true,
      'runnerUpgradeVerified' => true, 'runnerManagerIdentityPreserved' => true, 'jobCaBundleSha256' => security['jobCaBundleSha256']}}}
artifact = 'projects/4/jobs/24/artifacts/'
evidence_route = artifact + SystemReviewProof::EVIDENCE
release_route = artifact + 'test-results/successor/release.json'
jobs_route = 'projects/4/pipelines/10/jobs?per_page=100&include_retried=false'
related_route = 'projects/4/merge_requests/2/pipelines?per_page=100'
tree_route = "projects/4/repository/tree?ref=#{sha}&per_page=100"
baseline = {'projects/4' => project, 'projects/4/repository/branches/main' => {'protected' => true},
  'projects/4/pipelines/10' => pipeline, 'projects/4/jobs/90' => job, jobs_route => jobs,
  'projects/4/merge_requests/2' => {'iid' => 2, 'source_project_id' => 4, 'target_project_id' => 4,
    'target_branch' => 'main', 'state' => 'opened', 'sha' => sha}, related_route => [pipeline],
  tree_route => [{'path' => 'wizard', 'type' => 'commit', 'mode' => '160000', 'id' => wizard_sha}],
  'projects/7' => {'id' => 7, 'path_with_namespace' => 'team/wizard', 'namespace' => {'id' => 9},
    'default_branch' => 'master', 'visibility' => 'private'},
  "projects/7/repository/commits/#{wizard_sha}" => {'id' => wizard_sha},
  evidence_route => JSON.generate(proof),
  release_route => {'format' => 'system-successor-release-v1', 'sourceRevision' => sha, 'sourceTree' => 'c' * 40,
    'wizardRevision' => wizard_sha, 'projectId' => 4, 'pipelineId' => 10, 'candidateJobId' => 24,
    'imageId' => image('1'), 'wizardImageId' => image('2'), 'registryRepository' => registry + '/successor',
    'registryReference' => registry + '/successor@' + image('a'), 'wizardRegistryReference' => binding['wizardImageRef'],
    'candidateEvidencePath' => SystemReviewProof::EVIDENCE, 'candidateEvidenceSha256' => Digest::SHA256.hexdigest(JSON.generate(proof))}}
%w[on-exit after-script].each do |stage|
  baseline["projects/4/jobs/23/artifacts/test-results/wizard-browser/cleanup-#{stage}.json"] = {
    'container' => 'system-wizard-browser-4-23', 'image' => 'system-wizard-browser:ci-4-23', 'status' => 'passed'}
end
checks = 0
run = lambda do |mutate = nil|
  rows, data, calls = copy(baseline), copy(input), []
  mutate.call(rows, data) if mutate
  get = lambda do |route|
    calls << route
    copy(rows.fetch(route))
  end
  result = SystemReviewProof.verify!(get, data)
  checks += 1
  [result, calls]
end
reject = lambda do |mutate|
  begin
    run.call(mutate)
  rescue StandardError => error
    assert(error.message == SystemReviewProof::ERROR, 'unsafe or unexpected diagnostic: ' + error.message)
    checks += 1
    next
  end
  raise 'invalid System Review evidence accepted'
end
assert(run.call[0] == {ok: true, imageRef: binding['wizardImageRef'], helperImage: binding['helperImage']})
assert(run.call(->(_, data) { data['environments']['deployments']['review'] = {'active' => {'generation' => 'new'}}; data['environments']['historicalDeployments'] = [{'retained' => true}] })[0][:ok])
assert(run.call(->(rows, _) { rows['projects/4']['ci_config_path'] = '.gitlab-ci.yml' })[0][:ok])
assert(run.call(->(rows, _) { rows['projects/4/jobs/90'] = rows['projects/4/jobs/90'].merge('trace' => true) })[0][:ok],
  'Job detail response may contain more fields than the pipeline job listing')

[
  ->(_, data) { data['request']['kind'] = 'beta' },
  ->(_, data) { data['request']['projectId'] = 7 },
  ->(_, data) { data['request']['operation'] = '0' * 48 },
  ->(_, data) { data['binding']['version'] = 2 },
  ->(_, data) { data['binding']['helperImage'] = 'mutable:tag' },
  ->(_, data) { data['environments']['settings']['review']['host'] = 'other.example.test' },
  ->(_, data) { data['repository']['id'] = 99 },
  ->(rows, _) { rows['projects/4']['visibility'] = 'public' },
  ->(rows, _) { rows['projects/4']['namespace']['id'] = 99 },
  ->(rows, _) { rows['projects/4']['path_with_namespace'] = 'other/system' },
  ->(rows, _) { rows['projects/4']['default_branch'] = 'other' },
  ->(rows, _) { rows['projects/4']['ci_config_path'] = 'external.yml' },
  ->(rows, _) { rows['projects/4']['only_allow_merge_if_pipeline_succeeds'] = false },
  ->(rows, _) { rows['projects/4']['only_allow_merge_if_all_discussions_are_resolved'] = false },
  ->(rows, _) { rows['projects/4/repository/branches/main']['protected'] = false },
  ->(rows, _) { rows['projects/4/pipelines/10']['source'] = 'push' },
  ->(rows, _) { rows['projects/4/pipelines/10']['sha'] = '0' * 40 },
  ->(rows, _) { rows['projects/4/pipelines/10']['status'] = 'failed' },
  ->(rows, _) { rows['projects/4/jobs/90']['name'] = 'deploy:review' },
  ->(rows, _) { rows['projects/4/jobs/90']['allow_failure'] = false },
  ->(rows, _) { rows['projects/4/jobs/90']['pipeline']['id'] = 11 },
  ->(rows, _) { rows['projects/4/jobs/90']['status'] = 'success' },
  ->(rows, _) { rows['projects/4/merge_requests/2']['state'] = 'closed' },
  ->(rows, _) { rows['projects/4/merge_requests/2']['sha'] = '0' * 40 },
  ->(rows, _) { rows['projects/4/merge_requests/2']['source_project_id'] = 99 },
  ->(rows, _) { rows['projects/4/merge_requests/2']['target_branch'] = 'other' },
  ->(rows, _) { rows[related_route] << pipeline.merge('id' => 11) },
  ->(rows, _) { rows[related_route] = [] },
  ->(rows, _) { rows[jobs_route] << rows[jobs_route][0].merge('id' => 500) },
  ->(rows, _) { rows[jobs_route] << job.merge('id' => 500, 'name' => 'new-required-check', 'status' => 'failed', 'allow_failure' => false) },
  ->(rows, _) { rows[release_route]['format'] = 'other' },
  ->(rows, _) { rows[release_route]['candidateJobId'] = 25 },
  ->(rows, _) { rows[release_route]['imageId'] = image('0') },
  ->(rows, _) { rows[release_route]['wizardImageId'] = image('0') },
  ->(rows, _) { rows[release_route]['wizardRevision'] = '0' * 40 },
  ->(rows, _) { rows[release_route]['registryReference'] = 'foreign.example.test/team/system/successor@' + image('a') },
  ->(rows, _) { rows[release_route]['wizardRegistryReference'] = registry + '/successor-wizard:latest' },
  ->(rows, _) { rows[release_route]['candidateEvidencePath'] = 'other.json' },
  ->(rows, _) { rows[evidence_route] += "\n" },
  ->(rows, _) { rows[tree_route][0]['mode'] = '040000' },
  ->(rows, _) { rows[tree_route][0]['id'] = '0' * 40 },
  ->(rows, _) { rows['projects/7']['path_with_namespace'] = 'foreign/wizard' },
  ->(rows, _) { rows["projects/7/repository/commits/#{wizard_sha}"]['id'] = '0' * 40 },
  ->(rows, _) { rows['projects/4/jobs/23/artifacts/test-results/wizard-browser/cleanup-after-script.json']['status'] = 'failed' },
  ->(rows, _) { rows['projects/4/jobs/23/artifacts/test-results/wizard-browser/cleanup-on-exit.json']['container'] = 'foreign' }
].each { |mutate| reject.call(mutate) }
# A later page cannot hide a failed nonoptional job behind 100 optional jobs.
reject.call(->(rows, _) {
  rows[jobs_route] += (100 - rows[jobs_route].length).times.map { |index|
    job.merge('id' => 1000 + index, 'name' => "optional-#{index}", 'status' => 'manual') }
  rows[jobs_route + '&page=2'] = [job.merge('id' => 2000, 'name' => 'later-required', 'allow_failure' => false, 'status' => 'failed')]
})
SystemReviewProof::JOBS.each do |name|
  %w[status allow_failure commit pipeline].each do |field|
    reject.call(->(rows, _) {
      row = rows[jobs_route].find { |entry| entry['name'] == name }
      row[field] = {'status' => 'failed', 'allow_failure' => true, 'commit' => {'id' => '0' * 40}, 'pipeline' => {'id' => 11}}[field]
    })
  end
end
# Rehash damaged bytes to establish that semantic validation is independent of hashing.
proof_changes = [->(data) { data['fullAcceptance'] = false }, ->(data) { data['results'][0]['status'] = 'failed' },
  ->(data) { data['images']['wizard'] = image('0') }, ->(data) { data['evidence']['gitlabUpgrade']['runnerVersion'] = 'old' },
  ->(data) { data['evidence']['gitlabUpgrade']['jobCaBundleSha256'] = '0' * 64 },
  ->(data) { data['evidence']['gitlabUpgrade']['securityTrustVerified'] = false },
  ->(data) { data['evidence']['gitlabUpgrade']['fromRunnerImageId'] = data['images']['runner'] }]
SystemReviewProof::STAGES.each { |name| proof_changes << ->(data) { data['results'].reject! { |row| row['name'] == name } } }
SystemReviewProof::STORAGE.each { |name| proof_changes << ->(data) { data['evidence']['storage'][name] = false } }
proof_changes.each do |mutate|
  reject.call(->(rows, _) {
    data = JSON.parse(rows[evidence_route]); mutate.call(data)
    rows[evidence_route] = JSON.generate(data)
    rows[release_route]['candidateEvidenceSha256'] = Digest::SHA256.hexdigest(rows[evidence_route])
  })
end
%w[closed merged opened].each do |state|
  result, calls = run.call(->(rows, data) {
    data['request']['action'] = 'stop'; rows['projects/4/jobs/90']['name'] = 'stop:wizard-review'
    rows['projects/4/merge_requests/2'].merge!('state' => state, 'sha' => '0' * 40)
    rows['projects/4/pipelines/10']['status'] = 'failed'
    rows.delete_if { |route, _| route.include?('/artifacts/') || [tree_route, jobs_route, related_route].include?(route) }
  })
  assert(result[:ok] && calls.none? { |route| route.include?('/artifacts/') || route.include?('/tree?') || route.include?('/jobs?') || route.include?('/pipelines?') }, 'Stop depended on head, checks or expiring artifacts')
end

# Exercise the actual Rails adapter, including byte-preserving reads and revocation.
def Date.tomorrow = today + 1
class ReviewFixtureToken
  def token = 'fixture-token-must-not-be-emitted'
  def revoke! = $review_revoked += 1
end
class ReviewFixtureTokens
  def create!(**) = ReviewFixtureToken.new
end
class ReviewFixtureAdmin
  def admin? = true
  def active? = true
  def personal_access_tokens = ReviewFixtureTokens.new
end
class User
  def self.find_by_username(*) = ReviewFixtureAdmin.new
end
module Net
  class HTTP
    def self.start(*) = yield(new('offline.example.test'))
    def request(request)
      assert(request.is_a?(Net::HTTP::Get), 'verification mutated GitLab')
      value = $review_rows.fetch(request.path.delete_prefix('/api/v4/'))
      response = Struct.new(:code, :body) do
        def read_body
          (0...body.bytesize).step(65536) do |offset|
            $review_chunks += 1
            yield body.byteslice(offset, 65536)
          end
        end
      end.new('200', value.is_a?(String) ? value : JSON.generate(value))
      block_given? ? yield(response) : response
    end
  end
end
$review_rows, $review_revoked, $review_chunks = copy(baseline), 0, 0
BOOTSTRAPPER_SYSTEM_REVIEW_INPUT = Base64.strict_encode64(JSON.generate(input))
3.times do |index|
  $review_rows.delete(evidence_route) if index == 1
  if index == 2
    $review_rows = copy(baseline)
    $review_rows['projects/4'] = 'x' * (9 * 1024 * 1024)
    $review_chunks = 0
  end
  previous, $stdout = $stdout, StringIO.new
  begin
    Object.send(:remove_const, :SystemReviewProof)
    load File.expand_path('../../project-bootstrap/system-review/verify.rb', __dir__)
    output = $stdout.string
  ensure
    $stdout = previous
  end
  result = JSON.parse(output)
  assert(result['ok'] == (index == 0), 'Rails adapter result mismatch')
  assert(!output.include?('fixture-token'), 'credential emitted')
  assert($review_chunks == 129, 'HTTP adapter did not stop streaming at its byte limit') if index == 2
end
assert($review_revoked == 3, 'temporary verification token was not revoked on every outcome')
puts "System Review: #{checks} checks passed; exact canonical source/jobs, immutable candidate and browser cleanup, stale Stop, raw evidence and credential revocation."
