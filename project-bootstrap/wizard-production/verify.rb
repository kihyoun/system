# Read-only deployment evidence check inside the existing GitLab; never print credentials.
require 'json'
require 'base64'
require 'net/http'
require 'uri'
require 'digest'
input = JSON.parse(Base64.strict_decode64(WIZARD_PRODUCTION_PROOF))
binding = defined?(WIZARD_PRODUCTION_BINDING) ? JSON.parse(Base64.strict_decode64(WIZARD_PRODUCTION_BINDING)) : nil
credential = nil
begin
  admin = User.find_by_username('root')
  raise 'administrator' unless admin&.admin? && admin.active?
  credential = admin.personal_access_tokens.create!(name: 'system-bootstrapper-production-proof', scopes: ['api'], expires_at: Date.tomorrow)
  get = lambda do |route|
    uri = URI('http://127.0.0.1/api/v4/' + route)
    request = Net::HTTP::Get.new(uri); request['PRIVATE-TOKEN'] = credential.token
    response = Net::HTTP.start(uri.hostname, uri.port, open_timeout: 5, read_timeout: 20) { |http| http.request(request) }
    raise 'lookup' unless response.code == '200'
    JSON.parse(response.body)
  end
  prefix = "projects/#{Integer(input.fetch('projectId'))}/"
  project = get.call(prefix.delete_suffix('/'))
  raise 'project' unless project['visibility'] == 'private' && project['path_with_namespace'] == input.fetch('projectPath')
  if binding
    repository = binding.fetch('repository'); source_primary = binding.fetch('sourcePrimary')
    raise 'canonical-source-primary-binding' unless repository['managementMode'] == 'source-primary' &&
      repository['ciPath'] == '.gitlab/primary.yml' && source_primary['version'] == 1 &&
      repository['id'] == input.fetch('projectId') && repository['path'] == input.fetch('projectPath') &&
      repository['namespaceId'] == binding.fetch('namespaceId') && project.dig('namespace', 'id') == binding['namespaceId'] &&
      project['default_branch'] == repository['defaultBranch'] && project['ci_config_path'] == repository['ciPath'] &&
      project['only_allow_merge_if_pipeline_succeeds'] == true && project['only_allow_merge_if_all_discussions_are_resolved'] == true
    files = source_primary.fetch('ciFiles')
    raise 'source-primary-ci-manifest' unless files.is_a?(Array) && files.any? { |f| f['path'] == repository['ciPath'] } && files.map { |f| f['path'] }.uniq.length == files.length
    files.each do |source|
      raise 'source-primary-ci-path' unless source.fetch('path').match?(%r{\A(?:\.gitlab|\.system-bootstrapper)/[A-Za-z0-9_./-]+\z}) && !source['path'].split('/').include?('..')
      file = get.call(prefix + 'repository/files/' + URI.encode_www_form_component(source.fetch('path')) + '?ref=' + input.fetch('sourceCommit'))
      raise 'source-primary-ci-content' unless Digest::SHA256.hexdigest(Base64.strict_decode64(file.fetch('content').delete("\n"))) == source.fetch('sha256')
    end
    raise 'source-primary-image-project' unless input.fetch('imageRef').match?(%r{\A[a-z0-9.-]+(?::[0-9]+)?/#{Regexp.escape(repository.fetch('path'))}@sha256:[a-f0-9]{64}\z})
  else
    raise 'legacy-ci' unless project['ci_config_path'] == '.system-bootstrapper/ci.yml'
  end
  pipeline = get.call(prefix + "pipelines/#{Integer(input.fetch('pipelineId'))}")
  raise 'pipeline' unless pipeline['sha'] == input.fetch('sourceCommit') &&
    (binding ? ['created', 'pending', 'running', 'success', 'failed', 'canceled', 'manual', 'scheduled', 'waiting_for_resource', 'preparing'].include?(pipeline['status']) : pipeline['status'] == 'success')
  if binding
    raise 'native-default-pipeline' unless pipeline['ref'] == repository['defaultBranch'] && pipeline['source'] == 'push'
    branch = get.call(prefix + 'repository/branches/' + URI.encode_www_form_component(repository.fetch('defaultBranch')))
    raise 'native-default-head' unless branch.dig('commit', 'id') == pipeline['sha']
  end
  jobs = get.call(prefix + "pipelines/#{pipeline.fetch('id')}/jobs?per_page=100&include_retried=false")
  if binding
    ['build:source', 'test:browser', 'build:wizard', 'test:wizard'].each do |name|
      matches = jobs.select { |j| j['name'] == name }; job = matches.first
      raise 'required-native-check' unless matches.length == 1 && job['status'] == 'success' && job['allow_failure'] == false && job.dig('commit', 'id') == pipeline['sha'] && job.dig('pipeline', 'id') == pipeline['id']
    end
    publishers = jobs.select { |j| j['name'] == 'deploy:github' }; publisher = publishers.first
    raise 'publisher-identity' if publishers.length > 1 || (publisher && (publisher['allow_failure'] != false || publisher.dig('commit', 'id') != pipeline['sha'] || publisher.dig('pipeline', 'id') != pipeline['id']))
    failures = jobs.select { |j| j['allow_failure'] == false && j['name'] != 'deploy:github' && j['status'] != 'success' }
    raise 'native-check-failure' if !failures.empty? || (pipeline['status'] != 'success' && (!publisher || publisher['status'] == 'success'))
  end
  artifacts = ['build:wizard', 'test:wizard'].zip(['build-evidence.json', 'wizard-evidence.json']).map do |name, file|
    job = jobs.select { |row| row['name'] == name }.max_by { |row| row['id'] }
    raise 'job' unless job && job['status'] == 'success' && job['allow_failure'] == false && job.dig('commit', 'id') == pipeline['sha']
    artifact = get.call(prefix + "jobs/#{job.fetch('id')}/artifacts/#{file}")
    raise 'artifact' unless artifact['version'] == 1 && artifact['sourceCommit'] == pipeline['sha'] &&
      artifact['pipelineId'] == pipeline['id'] && artifact['imageRef'] == input.fetch('imageRef')
    artifact
  end
  build, smoke = artifacts
  raise 'checks' unless build['unitTests'] == true && build['testRunner'] == 'vitest' && build['lint'] == true &&
    build['typecheck'] == true && build['productionBuild'] == true &&
    ['http', 'renderedUI', 'projects', 'spa', 'configurationBackup', 'cubeSignature'].all? { |key| smoke[key] == true }
  result = {ok: true}
rescue StandardError
  result = {ok: false}
ensure
  credential.revoke! if credential
end
puts JSON.generate(result)
