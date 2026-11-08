# Runs inside GitLab; temporary verification credentials never leave the process.
require 'json'
require 'base64'
require 'net/http'
require 'uri'
require 'digest'
require 'date'

class SystemReviewProof
  COMPONENTS = %w[gitlab sync gitlab-runner bootstrapper nginx wizard shared performance].freeze
  JOBS = (%w[check:documentation prepare:wizard-source test:candidate-image test:wizard-browser test:platform-candidate build] +
    COMPONENTS.map { |component| "test:isolated: [#{component}]" }).freeze
  STAGES = %w[gitlab-upgrade-migrated-data gitlab-upgrade-registry-ci gitlab-upgrade-restored-checkpoint
    gitlab-upgrade-security-trust storage-global-live-lease storage-refuse-nonempty-and-corrupt-restore
    storage-detached-backup-normal-operation cleanup].freeze
  STORAGE = %w[localLiveVerified externalSeedRestored backupDetached missingBackupGuardVerified globalLeaseVerified invalidRestoreGuardVerified].freeze
  EVIDENCE = 'test-results/successor/candidate-results.json'.freeze
  ERROR = 'Canonical System Review source, job, or candidate checks failed.'.freeze
  MAX_HTTP_BYTES = 8 * 1024 * 1024

  def self.require!(condition)
    raise ERROR unless condition
  end

  def self.sha?(value) = value.is_a?(String) && value.match?(/\A[a-f0-9]{40}\z/)
  def self.image?(value) = value.is_a?(String) && value.match?(/\Asha256:[a-f0-9]{64}\z/)
  def self.id?(value) = value.is_a?(Integer) && value > 0

  # GitLab caps pages at 100; never silently ignore required or failed jobs.
  def self.pages(get, route)
    rows = get.call(route)
    require!(rows.is_a?(Array) && rows.length <= 100)
    all = rows.dup
    page = 1
    while rows.length == 100
      page += 1
      require!(page <= 100)
      rows = get.call(route + "&page=#{page}")
      require!(rows.is_a?(Array) && rows.length <= 100)
      all.concat(rows)
    end
    all
  end

  def self.project!(project, id, path, namespace, branch)
    require!(project['id'] == id && project['path_with_namespace'] == path &&
      project.dig('namespace', 'id') == namespace && project['default_branch'] == branch && project['visibility'] == 'private')
  end

  def self.bound_job?(row, binding)
    id?(row['id']) && row.dig('pipeline', 'id') == binding['pipelineId'] &&
      row.dig('commit', 'id') == binding['sourceCommit'] &&
      (!row.key?('project_id') || row['project_id'] == binding['projectId'])
  end

  def self.evidence!(proof, release, security)
    require!(proof['sourceRevision'] == release['sourceRevision'] && proof['fullAcceptance'] == true &&
      proof.fetch('runId', '').match?(/\A[a-f0-9]{24}\z/))
    rows = proof.fetch('results')
    require!(rows.is_a?(Array) && !rows.empty? && rows.all? { |row| row.is_a?(Hash) && row['status'] == 'passed' } &&
      STAGES.all? { |name| rows.any? { |row| row['name'] == name } })
    storage, upgrade, images = proof.dig('evidence', 'storage'), proof.dig('evidence', 'gitlabUpgrade'), proof.fetch('images')
    require!(STORAGE.all? { |key| storage.fetch(key) == true })
    require!(images['candidate'] == release['imageId'] && images['wizard'] == release['wizardImageId'] &&
      upgrade['fromImage'] == security.fetch('fromImage') && upgrade['toImage'] == security.fetch('toImage') &&
      %w[migrationVerified rollbackVerified registryVerified checkpointVerified].all? { |key| upgrade[key] == true } &&
      image?(upgrade['fromImageId']) && image?(upgrade['toImageId']) && images['gitlab'] == upgrade['toImageId'])
    runner = security.fetch('runner')
    require!(upgrade['runnerImage'] == runner.fetch('toImage') && upgrade['runnerImageId'] == images['runner'] &&
      upgrade['runnerVersion'] == runner.fetch('toVersion') && upgrade['helperImage'] == runner.fetch('helperImage') &&
      upgrade['jobCaBundleSha256'] == security.fetch('jobCaBundleSha256') &&
      %w[securityTrustVerified runnerUpgradeVerified runnerManagerIdentityPreserved].all? { |key| upgrade[key] == true } &&
      %w[runnerImageId fromRunnerImageId helperImageId fromHelperImageId].all? { |key| image?(upgrade[key]) } &&
      upgrade['fromRunnerImageId'] != upgrade['runnerImageId'] && upgrade['fromHelperImageId'] != upgrade['helperImageId'])
  end

  def self.verify!(get, input, raw: get)
    binding, request = input.fetch('binding'), input.fetch('request')
    environment, repository = input.fetch('environments'), input.fetch('repository')
    require!(binding['version'] == 1 && request['kind'] == 'review' && %w[deploy stop].include?(request['action']) &&
      %w[projectId namespaceId mrIid pipelineId candidateJobId wizardProjectId].all? { |key| id?(binding[key]) } &&
      sha?(binding['sourceCommit']) && sha?(binding['wizardRevision']) && image?(binding['helperImage']) && image?(binding['wizardImageId']) &&
      binding.fetch('operation').match?(/\A[a-f0-9]{48}\z/) &&
      %w[operation projectId mrIid pipelineId sourceCommit].all? { |key| binding[key] == request[key] } && id?(request['jobId']))
    reservation = environment.reject { |key, _| %w[deployments historicalDeployments].include?(key) }
    require!(environment['version'] == 1 && environment['phase'] == 'ready' && environment['managementMode'] == 'source-primary' &&
      environment['operation'] == binding['operation'] && image?(environment['helperImage']) &&
      environment['controller'] == 'system_bootstrapper_1' && sha?(environment['activationCommit']) &&
      environment.dig('settings', 'review', 'enabled') == true &&
      binding['environmentHash'] == Digest::SHA256.hexdigest(JSON.generate(reservation)))
    require!(repository['id'] == binding['wizardProjectId'] && repository['path'] == binding['wizardProjectPath'] &&
      repository['namespaceId'] == binding['namespaceId'] && repository['defaultBranch'] == binding['wizardDefaultBranch'])
    id = binding.fetch('projectId'); prefix = "projects/#{id}/"
    project = get.call("projects/#{id}")
    project!(project, id, binding.fetch('projectPath'), binding.fetch('namespaceId'), binding.fetch('defaultBranch'))
    require!([nil, '.gitlab-ci.yml'].include?(project['ci_config_path']) &&
      project['only_allow_merge_if_pipeline_succeeds'] == true && project['only_allow_merge_if_all_discussions_are_resolved'] == true)
    branch = get.call(prefix + 'repository/branches/' + URI.encode_www_form_component(binding.fetch('defaultBranch')))
    require!(branch['protected'] == true)
    pipeline = get.call(prefix + 'pipelines/' + binding.fetch('pipelineId').to_s)
    require!(pipeline['id'] == binding['pipelineId'] && pipeline['sha'] == binding['sourceCommit'] &&
      pipeline['source'] == 'merge_request_event' && (!pipeline.key?('project_id') || pipeline['project_id'] == id))
    job = get.call(prefix + 'jobs/' + request.fetch('jobId').to_s)
    require!(job['id'] == request['jobId'] && bound_job?(job, binding) && job['name'] == request['action'] + ':wizard-review' &&
      job['status'] == 'running' && job['allow_failure'] == true)
    mr = get.call(prefix + 'merge_requests/' + binding.fetch('mrIid').to_s)
    require!(mr['iid'] == binding['mrIid'] && mr['source_project_id'] == id && mr['target_project_id'] == id &&
      mr['target_branch'] == binding['defaultBranch'])
    # Cleanup must remain possible after an MR closes, advances or loses artifacts.
    return {ok: true, helperImage: binding['helperImage']} if request['action'] == 'stop'

    require!(mr['state'] == 'opened' && (mr['sha'] || mr.dig('diff_refs', 'head_sha')) == binding['sourceCommit'] &&
      %w[running success].include?(pipeline['status']))
    related = pages(get, prefix + 'merge_requests/' + binding.fetch('mrIid').to_s + '/pipelines?per_page=100')
    require!(related.any? { |row| row['id'] == binding['pipelineId'] && row['sha'] == binding['sourceCommit'] } &&
      related.all? { |row| id?(row['id']) && row['id'] <= binding['pipelineId'] })
    jobs = pages(get, prefix + 'pipelines/' + binding.fetch('pipelineId').to_s + '/jobs?per_page=100&include_retried=false')
    require!(jobs.map { |row| row['id'] }.uniq.length == jobs.length)
    JOBS.each do |name|
      selected = jobs.select { |row| row['name'] == name }
      require!(selected.length == 1 && bound_job?(selected[0], binding) && selected[0]['status'] == 'success' && selected[0]['allow_failure'] == false)
    end
    require!(jobs.count { |row| row['id'] == request['jobId'] && row['name'] == job['name'] &&
      row['status'] == 'running' && row['allow_failure'] == true && bound_job?(row, binding) } == 1 &&
      jobs.reject { |row| row['allow_failure'] == true }.all? { |row| bound_job?(row, binding) && row['status'] == 'success' })
    candidate = jobs.find { |row| row['name'] == 'test:platform-candidate' }
    require!(candidate['id'] == binding['candidateJobId'])
    artifact = prefix + 'jobs/' + candidate.fetch('id').to_s + '/artifacts/'
    release = get.call(artifact + 'test-results/successor/release.json')
    registry = project.fetch('container_registry_image_prefix')
    require!(registry.match?(%r{\A[a-zA-Z0-9.-]+(?::[0-9]+)?/#{Regexp.escape(binding.fetch('projectPath'))}\z}) &&
      release['format'] == 'system-successor-release-v1' && release['projectId'] == id &&
      release['pipelineId'] == binding['pipelineId'] && release['candidateJobId'] == binding['candidateJobId'] &&
      release['sourceRevision'] == binding['sourceCommit'] && sha?(release['sourceTree']) &&
      release['wizardRevision'] == binding['wizardRevision'] && release['imageId'] == binding['helperImage'] &&
      release['wizardImageId'] == binding['wizardImageId'] && release['registryRepository'] == registry + '/successor' &&
      release.fetch('registryReference', '').match?(%r{\A#{Regexp.escape(registry)}/successor@sha256:[a-f0-9]{64}\z}) &&
      release['wizardRegistryReference'] == binding['wizardImageRef'] &&
      release.fetch('wizardRegistryReference', '').match?(%r{\A#{Regexp.escape(registry)}/successor-wizard@sha256:[a-f0-9]{64}\z}) &&
      release['candidateEvidencePath'] == EVIDENCE)
    bytes = raw.call(artifact + EVIDENCE)
    require!(bytes.is_a?(String) && release['candidateEvidenceSha256'] == Digest::SHA256.hexdigest(bytes))
    evidence!(JSON.parse(bytes), release, input.fetch('securityRelease'))
    tree = pages(get, prefix + 'repository/tree?ref=' + binding.fetch('sourceCommit') + '&per_page=100')
    wizard = tree.select { |row| row['path'] == 'wizard' }
    require!(wizard.length == 1 && wizard[0]['type'] == 'commit' && wizard[0]['mode'] == '160000' && wizard[0]['id'] == binding['wizardRevision'])
    wizard_project = get.call('projects/' + binding.fetch('wizardProjectId').to_s)
    project!(wizard_project, repository.fetch('id'), repository.fetch('path'), repository.fetch('namespaceId'), repository.fetch('defaultBranch'))
    commit = get.call('projects/' + repository.fetch('id').to_s + '/repository/commits/' + binding.fetch('wizardRevision'))
    require!(commit['id'] == binding['wizardRevision'])
    browser = jobs.find { |row| row['name'] == 'test:wizard-browser' }
    %w[on-exit after-script].each do |stage|
      cleanup = get.call(prefix + "jobs/#{browser.fetch('id')}/artifacts/test-results/wizard-browser/cleanup-#{stage}.json")
      require!(cleanup['status'] == 'passed' && cleanup['container'] == "system-wizard-browser-#{id}-#{browser.fetch('id')}" &&
        cleanup['image'] == "system-wizard-browser:ci-#{id}-#{browser.fetch('id')}")
    end
    {ok: true, imageRef: binding.fetch('wizardImageRef'), helperImage: binding.fetch('helperImage')}
  rescue StandardError
    raise ERROR
  end
end

if defined?(BOOTSTRAPPER_SYSTEM_REVIEW_INPUT)
  credential = nil
  begin
    input = JSON.parse(Base64.strict_decode64(BOOTSTRAPPER_SYSTEM_REVIEW_INPUT))
    admin = User.find_by_username('root')
    raise SystemReviewProof::ERROR unless admin&.admin? && admin.active?
    credential = admin.personal_access_tokens.create!(name: 'system-bootstrapper-system-review-check', scopes: ['api'], expires_at: Date.tomorrow)
    raw = lambda do |route|
      uri = URI('http://127.0.0.1/api/v4/' + route)
      request = Net::HTTP::Get.new(uri)
      request['PRIVATE-TOKEN'] = credential.token
      bytes = ''.b
      Net::HTTP.start(uri.hostname, uri.port, open_timeout: 5, read_timeout: 20) do |http|
        http.request(request) do |response|
          raise SystemReviewProof::ERROR unless response.code == '200'
          response.read_body do |chunk|
            raise SystemReviewProof::ERROR if bytes.bytesize + chunk.bytesize > SystemReviewProof::MAX_HTTP_BYTES
            bytes << chunk
          end
        end
      end
      bytes
    end
    get = ->(route) { JSON.parse(raw.call(route)) }
    result = SystemReviewProof.verify!(get, input, raw: raw)
  rescue StandardError
    result = {ok: false, message: SystemReviewProof::ERROR}
  ensure
    credential.revoke! if credential
  end
  puts JSON.generate(result)
end
