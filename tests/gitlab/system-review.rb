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
# Historical evidence remains readable for owned Stop only.
get = ->(route) { copy(baseline.fetch(route)) }
begin
  SystemReviewProof.verify!(get, input)
  raise 'retired Review deployment accepted'
rescue StandardError => error
  assert(error.message == SystemReviewProof::ERROR)
end
input['request']['action'] = 'stop'
baseline['projects/4/jobs/90']['name'] = 'stop:wizard-review'
baseline['projects/4/merge_requests/2']['state'] = 'closed'
baseline.delete_if { |route, _| route.include?('/artifacts/') }
assert(SystemReviewProof.verify!(get, input)[:ok])
%w[projectId pipelineId sourceCommit mrIid operation].each do |key|
  bad = copy(input)
  bad['request'][key] = key == 'sourceCommit' || key == 'operation' ? '0' * 40 : 999
  begin
    SystemReviewProof.verify!(get, bad)
    raise 'foreign Review Stop accepted'
  rescue StandardError => error
    assert(error.message == SystemReviewProof::ERROR)
  end
end
puts 'Legacy System Review: retired deploy, retained exact owned Stop after MR closure and artifact expiry, foreign identity rejection passed.'
