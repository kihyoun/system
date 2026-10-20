# Runs only inside the existing GitLab container. Never emits credentials.
require 'json'
require 'base64'
require 'net/http'
require 'uri'
require 'digest'
class WizardEnvironmentProof
  def self.files!(get, prefix, sha, files, activation)
    raise 'managed-file-proof' unless sha.match?(/\A[a-f0-9]{40}\z/) && activation.match?(/\A[a-f0-9]{40}\z/) &&
      !files.empty? && files.map { |source| source.fetch('path') }.uniq.length == files.length
    files.each do |source|
      row = get.call(prefix + 'repository/files/' + URI.encode_www_form_component(source.fetch('path')) + '?ref=' + sha)
      raise 'managed-file-content' unless row['last_commit_id'] == activation &&
        Base64.strict_decode64(row.fetch('content').delete("\n")) == source.fetch('content')
    end
  end
  def self.native_jobs!(jobs, pipeline, project_id)
    names = ['build:source', 'test:browser', 'build:wizard', 'test:wizard']
    bound = lambda do |row|
      row['id'].is_a?(Integer) && row['id'] > 0 && row.dig('commit', 'id') == pipeline.fetch('sha') &&
        row.dig('pipeline', 'id') == pipeline.fetch('id') &&
        (!row.key?('project_id') || row['project_id'] == project_id)
    end
    raise 'native-required-jobs' unless names.all? do |name|
      selected = jobs.select { |row| row['name'] == name }
      selected.length == 1 && bound.call(selected[0]) && selected[0]['allow_failure'] == false && selected[0]['status'] == 'success'
    end
    publishers = jobs.select { |row| row['name'] == 'deploy:github' }
    raise 'native-publisher' unless publishers.empty? || (publishers.length == 1 && bound.call(publishers[0]) &&
      publishers[0]['allow_failure'] == false && ['created', 'pending', 'running', 'success', 'failed', 'canceled', 'manual', 'scheduled', 'waiting_for_resource', 'preparing'].include?(publishers[0]['status']))
    raise 'native-other-job' unless jobs.reject { |row| row['name'] == 'deploy:github' || row['allow_failure'] == true }.all? do |row|
      bound.call(row) && row['status'] == 'success'
    end
    # A running manual environment job makes an otherwise accepted pipeline
    # running again. An independently identified publisher cannot block native delivery.
    allowed = ['created', 'pending', 'running', 'success', 'failed', 'canceled', 'manual', 'scheduled', 'waiting_for_resource', 'preparing']
    raise 'native-pipeline' unless allowed.include?(pipeline['status']) &&
      (['success', 'running'].include?(pipeline['status']) || (publishers.length == 1 && publishers[0]['status'] != 'success'))
    ['build:wizard', 'test:wizard'].map { |name| jobs.find { |row| row['name'] == name } }
  end
  def self.source_primary!(get, prefix, repository, binding, environment, project, sha)
    raise 'source-primary-ownership' unless repository['managementMode'] == 'source-primary' &&
      repository['ciPath'] == '.gitlab/primary.yml' && project['ci_config_path'] == '.gitlab/primary.yml' &&
      project.dig('namespace', 'id') == repository.fetch('namespaceId') && project['visibility'] == 'private' &&
      project['only_allow_merge_if_pipeline_succeeds'] == true && project['only_allow_merge_if_all_discussions_are_resolved'] == true &&
      binding['version'] == 1 && environment['managementMode'] == 'source-primary' &&
      environment.fetch('activationCommit') == binding.fetch('adoptionCommit')
    files = binding.fetch('ciFiles')
    raise 'source-primary-files' unless files == environment.fetch('ciFiles') && files.is_a?(Array) && !files.empty? && files.length <= 40 &&
      files.map { |row| row['path'] }.uniq.length == files.length &&
      ['.gitlab/primary.yml', '.gitlab/delivery/environment.sh'].all? { |name| files.any? { |row| row['path'] == name } }
    files.each do |row|
      name = row.fetch('path')
      raise 'source-primary-file' unless row.keys.sort == ['path', 'sha256'] &&
        name.match?(%r{\A(?:\.gitlab/|\.system-bootstrapper/build-v1/)[A-Za-z0-9_./-]+\z}) &&
        !name.split('/').include?('..') && row.fetch('sha256').match?(/\A[a-f0-9]{64}\z/)
      file = get.call(prefix + 'repository/files/' + URI.encode_www_form_component(name) + '?ref=' + sha)
      raise 'source-primary-content' unless Digest::SHA256.hexdigest(Base64.strict_decode64(file.fetch('content').delete("\n"))) == row.fetch('sha256')
    end
  end
end
if defined?(BOOTSTRAPPER_ENVIRONMENT_INPUT)
input = JSON.parse(Base64.strict_decode64(BOOTSTRAPPER_ENVIRONMENT_INPUT))
credential = nil
begin
  admin = User.find_by_username('root')
  raise 'administrator' unless admin&.admin? && admin.active?
  credential = admin.personal_access_tokens.create!(name: 'system-bootstrapper-environment-check', scopes: ['api'], expires_at: Date.tomorrow)
  get = lambda do |route|
    uri = URI('http://127.0.0.1/api/v4/' + route)
    request = Net::HTTP::Get.new(uri)
    request['PRIVATE-TOKEN'] = credential.token
    response = Net::HTTP.start(uri.hostname, uri.port, open_timeout: 5, read_timeout: 20) { |http| http.request(request) }
    raise 'lookup' unless response.code == '200'
    JSON.parse(response.body)
  end
  repository, request = input.fetch('repository'), input.fetch('request')
  id = Integer(repository.fetch('id'))
  raise 'project' unless id == request.fetch('projectId')
  prefix = "projects/#{id}/"
  project = get.call("projects/#{id}")
  raise 'ownership' unless project['id'] == id && project['path_with_namespace'] == repository.fetch('path') && project['default_branch'] == repository.fetch('defaultBranch')
  source_primary = repository['managementMode'] == 'source-primary'
  unless source_primary
    raise 'ownership' unless !repository['managementMode'] && project['description'] == 'System Bootstrapper operation ' + input.fetch('registrationOperation') &&
      project['visibility'] == 'private' && project['ci_config_path'] == '.system-bootstrapper/ci.yml'
  end
  pipeline = get.call(prefix + 'pipelines/' + request.fetch('pipelineId').to_s)
  raise 'pipeline' unless pipeline['id'] == request.fetch('pipelineId') && pipeline['sha'] == request.fetch('sourceCommit')
  job = get.call(prefix + 'jobs/' + request.fetch('jobId').to_s)
  raise 'job' unless job.dig('pipeline', 'id') == pipeline['id'] && job.dig('commit', 'id') == pipeline['sha'] &&
    job['name'] == request.fetch('action') + ':' + request.fetch('kind') && job['status'] == 'running'
  raise 'native-manual-job' if source_primary && job['allow_failure'] != true
  environment, recipe = input.fetch('environments'), input['recipe']
  if source_primary
    WizardEnvironmentProof.source_primary!(get, prefix, repository, input.fetch('sourcePrimary'), environment, project, pipeline.fetch('sha'))
  else
  expected_files = recipe.fetch('files') + [{'path' => '.system-bootstrapper/ci.yml', 'content' => recipe.fetch('ci')}]
  WizardEnvironmentProof.files!(get, prefix, pipeline.fetch('sha'), expected_files, environment.fetch('activationCommit'))
  legacy_files = input.fetch('legacyFiles')
  legacy_marker = input.fetch('legacyMarker')
  raise 'legacy-proof' unless !legacy_files.empty? && legacy_files.all? { |source| source.fetch('path').start_with?('.system-bootstrapper/build-v1/') } &&
    legacy_marker.fetch('path') == '.system-bootstrapper/wizard-build.json'
  WizardEnvironmentProof.files!(get, prefix, pipeline.fetch('sha'), legacy_files + [legacy_marker], input.fetch('buildActivationCommit'))
  marker = get.call(prefix + 'repository/files/' + URI.encode_www_form_component('.system-bootstrapper/wizard-environments.json') + '?ref=' + pipeline.fetch('sha'))
  parsed = JSON.parse(Base64.strict_decode64(marker.fetch('content').delete("\n")))
  expected_marker = {'version' => 1, 'operation' => environment.fetch('operation'), 'recipeHash' => environment.fetch('recipeHash'),
    'settingsHash' => environment.fetch('settingsHash'), 'helperImage' => environment.fetch('helperImage'), 'controller' => environment.fetch('controller')}
  raise 'marker' unless marker['last_commit_id'] == environment.fetch('activationCommit') &&
    parsed.reject { |key, _| key == 'parentCommit' } == expected_marker && parsed.fetch('parentCommit').match?(/\A[a-f0-9]{40}\z/)
  activation = get.call(prefix + 'repository/commits/' + environment.fetch('activationCommit'))
  raise 'activation-parent' unless activation['parent_ids'] == [parsed.fetch('parentCommit')]
  end
  if request['kind'] == 'review'
    raise 'source' unless pipeline['source'] == 'merge_request_event'
    mr = get.call(prefix + 'merge_requests/' + request.fetch('mrIid').to_s)
    raise 'merge-request' unless mr['iid'] == request.fetch('mrIid') && mr['source_project_id'] == id && mr['target_project_id'] == id
    if request['action'] == 'deploy'
      raise 'merge-request-head' unless mr['state'] == 'opened' && (mr['sha'] || mr.dig('diff_refs', 'head_sha')) == pipeline['sha']
      related = get.call(prefix + 'merge_requests/' + request.fetch('mrIid').to_s + '/pipelines?per_page=100')
      raise 'merge-request-pipeline' unless related.any? { |p| p['id'] == pipeline['id'] && p['sha'] == pipeline['sha'] } &&
        related.none? { |p| p['id'] > pipeline['id'] }
    end
  else
    raise 'beta-ref' unless pipeline['ref'] == project.fetch('default_branch') && ['push', 'api', 'web'].include?(pipeline['source'])
    if request['action'] == 'deploy'
      branch = get.call(prefix + 'repository/branches/' + URI.encode_www_form_component(project.fetch('default_branch')))
      raise 'beta-head' unless branch.dig('commit', 'id') == pipeline['sha']
    end
  end
  result = {ok: true}
  if request['action'] == 'deploy'
    jobs = get.call(prefix + 'pipelines/' + pipeline.fetch('id').to_s + '/jobs?per_page=100&include_retried=false')
    if source_primary
      raise 'duplicate-required-jobs' unless ['build:wizard', 'test:wizard'].all? { |name| jobs.count { |row| row['name'] == name } == 1 }
    end
    required = source_primary ? WizardEnvironmentProof.native_jobs!(jobs, pipeline, id) :
      ['build:wizard', 'test:wizard'].map { |name| jobs.select { |j| j['name'] == name }.max_by { |j| j.fetch('id') } }
    raise 'checks' unless required.all? { |j| j && j['status'] == 'success' && j['allow_failure'] == false && j.dig('commit', 'id') == pipeline['sha'] }
    artifacts = required.zip(['build-evidence.json', 'wizard-evidence.json']).map do |j, filename|
      artifact = get.call(prefix + 'jobs/' + j.fetch('id').to_s + '/artifacts/' + filename)
      raise 'artifact' unless artifact['version'] == 1 && artifact['sourceCommit'] == pipeline['sha'] && artifact['pipelineId'] == pipeline['id'] &&
        artifact.fetch('imageRef', '').match?(/\A#{Regexp.escape(input.fetch('registryPrefix'))}@sha256:[a-f0-9]{64}\z/)
      artifact
    end
    raise 'evidence' unless (artifacts[0]['jest'] == true || (artifacts[0]['unitTests'] == true &&
      artifacts[0]['testRunner'] == 'vitest' && artifacts[0]['lint'] == true && artifacts[0]['typecheck'] == true)) &&
      artifacts[0]['productionBuild'] == true &&
      ['http', 'renderedUI', 'projects', 'spa'].all? { |key| artifacts[1][key] == true } &&
      (artifacts[0]['testRunner'] != 'vitest' || ['configurationBackup', 'cubeSignature'].all? { |key| artifacts[1][key] == true }) &&
      artifacts[0]['imageRef'] == artifacts[1]['imageRef']
    if source_primary
      raise 'native-modern-checks' unless artifacts[0]['unitTests'] == true && artifacts[0]['testRunner'] == 'vitest' &&
        artifacts[0]['lint'] == true && artifacts[0]['typecheck'] == true
      required.each_with_index do |required_job, index|
        expected = index == 0 ? "wizard-build-#{id}-#{required_job.fetch('id')}" : "wizard-check-#{id}-#{required_job.fetch('id')}-builder"
        cleanup = get.call(prefix + 'jobs/' + required_job.fetch('id').to_s + '/artifacts/cleanup.json')
        raise 'native-cleanup' unless cleanup['status'] == 'passed' && cleanup['builder'] == expected
      end
      browser = get.call(prefix + 'jobs/' + required[1].fetch('id').to_s + '/artifacts/browser-evidence/browser.json')
      raise 'native-browser' unless ['http', 'renderedUI', 'projects', 'spa', 'configurationBackup', 'cubeSignature', 'overviewNavigation'].all? { |key| browser[key] == true }
    end
    result[:imageRef] = artifacts[0].fetch('imageRef')
  end
rescue StandardError
  result = {ok: false, message: 'Canonical GitLab job, source, or verified candidate checks failed.'}
ensure
  credential.revoke! if credential
end
puts JSON.generate(result)
end
