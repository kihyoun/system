# Read-only deployment evidence check inside the existing GitLab; never print credentials.
require 'json'
require 'base64'
require 'net/http'
require 'uri'
input = JSON.parse(Base64.strict_decode64(WIZARD_PRODUCTION_PROOF))
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
  raise 'project' unless project['visibility'] == 'private' && project['path_with_namespace'] == input.fetch('projectPath') &&
    project['ci_config_path'] == '.system-bootstrapper/ci.yml'
  pipeline = get.call(prefix + "pipelines/#{Integer(input.fetch('pipelineId'))}")
  raise 'pipeline' unless pipeline['status'] == 'success' && pipeline['sha'] == input.fetch('sourceCommit')
  jobs = get.call(prefix + "pipelines/#{pipeline.fetch('id')}/jobs?per_page=100&include_retried=false")
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
