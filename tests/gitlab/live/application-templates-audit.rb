# Run inside the local GitLab after the Sync integration test. No PAT is output.
require 'json'
require 'net/http'
require 'base64'

projects = JSON.parse(Base64.strict_decode64(BOOTSTRAPPER_TEST_PROJECTS))
credential = nil
begin
  admin = User.find_by_username('root')
  credential = admin.personal_access_tokens.create!(name: 'system-bootstrapper-template-audit', scopes: ['api'], expires_at: Date.tomorrow)
  get = lambda do |route|
    uri = URI('http://127.0.0.1/api/v4/' + route)
    request = Net::HTTP::Get.new(uri)
    request['PRIVATE-TOKEN'] = credential.token
    response = Net::HTTP.start(uri.hostname, uri.port, read_timeout: 30) { |http| http.request(request) }
    raise "Audit lookup HTTP #{response.code}" unless response.code == '200'
    JSON.parse(response.body)
  end
  projects.each do |metadata|
    id = metadata.fetch('id')
    project = Project.find(id)
    raise 'Wrong template identity' unless project.private? && project.path == metadata.fetch('path').split('/').last
    raise 'Missing Dockerfile' unless project.repository.blob_at(project.default_branch, 'Dockerfile')
    raise 'Missing starter source' unless project.repository.blob_at(project.default_branch, metadata['template'] == 'web' ? 'main.js' : metadata['template'] == 'react' ? 'src/App.tsx' : 'src/app/app.html')
    pipelines = get.call("projects/#{id}/pipelines?source=api")
    raise 'Duplicate initial API pipelines' unless pipelines.length == 1
    pipeline_id = metadata.fetch('initialPipeline').fetch('id')
    if ENV['RETRY_FAILED_PIPELINES'] == 'true' && get.call("projects/#{id}/pipelines/#{pipeline_id}")['status'] == 'failed'
      failed = get.call("projects/#{id}/pipelines/#{pipeline_id}/jobs").select { |job| job['status'] == 'failed' }
      failed.each do |job|
        uri = URI("http://127.0.0.1/api/v4/projects/#{id}/jobs/#{job['id']}/retry")
        request = Net::HTTP::Post.new(uri)
        request['PRIVATE-TOKEN'] = credential.token
        response = Net::HTTP.start(uri.hostname, uri.port) { |http| http.request(request) }
        raise "Could not retry failed job after infrastructure repair (HTTP #{response.code})" unless response.code.to_i.between?(200, 299)
      end
      sleep 3
    end
    pipeline = nil
    240.times do
      pipeline = get.call("projects/#{id}/pipelines/#{pipeline_id}")
      break if %w[success failed canceled skipped manual].include?(pipeline['status'])
      sleep 3
    end
    if pipeline['status'] != 'success'
      jobs = get.call("projects/#{id}/pipelines/#{pipeline_id}/jobs")
      puts JSON.generate(template: metadata['template'], status: pipeline['status'], jobs: jobs.map { |job| {name: job['name'], status: job['status']} })
      raise 'Initial template pipeline did not succeed'
    end
    environments = get.call("projects/#{id}/environments")
    raise 'Expected production and review deployments' unless environments.any? { |item| item['name'] == 'production' } && environments.any? { |item| item['name'].start_with?('review/') }
    puts JSON.generate(template: metadata['template'], pipeline: 'success', unique_initial_pipeline: true, production_and_review: true)
  end
  raise 'Project setup credentials were not revoked' unless admin.personal_access_tokens.where(
    name: 'system-bootstrapper-project-setup', revoked: false).count == 0
ensure
  credential.revoke! if credential
end
