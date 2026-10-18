# Executed only inside our GitLab container; credentials never leave Rails.
require 'json'
require 'base64'
require 'net/http'
require 'uri'

class BootstrapError < StandardError; end

input = JSON.parse(Base64.strict_decode64(BOOTSTRAPPER_INPUT))
credential = nil
result = nil
begin
  admin = User.find_by_username('root')
  raise BootstrapError, 'No active administrator' unless admin&.admin? && admin.active?
  # Only clean expired credentials: concurrent lookups must not revoke one another.
  admin.personal_access_tokens.where(name: 'system-bootstrapper-project-setup', revoked: false)
    .where('expires_at < ?', Date.today).find_each(&:revoke!)
  credential = admin.personal_access_tokens.create!(name: 'system-bootstrapper-project-setup',
    scopes: ['api'], expires_at: Date.tomorrow)
  api = lambda do |method, route, body = nil|
    uri = URI('http://127.0.0.1/api/v4/' + route)
    request = method.new(uri)
    request['PRIVATE-TOKEN'] = credential.token
    if body
      request['Content-Type'] = 'application/json'
      request.body = JSON.generate(body)
    end
    response = Net::HTTP.start(uri.hostname, uri.port, open_timeout: 10, read_timeout: 60) { |http| http.request(request) }
    [response.code.to_i, JSON.parse(response.body)]
  end
  if input['action'] == 'namespaces'
    namespaces = []
    page = 1
    loop do
      code, rows = api.call(Net::HTTP::Get, "namespaces?per_page=100&page=#{page}")
      raise BootstrapError, 'Namespace lookup failed' unless code == 200
      namespaces.concat(rows.map { |row| {id: row.fetch('id'), path: row.fetch('full_path')} })
      break if rows.length < 100
      page += 1
    end
    result = {namespaces: namespaces}
  else
    key = input.fetch('projectKey')
    raise BootstrapError, 'Invalid Project Key' unless key.match?(/\A[a-z0-9]+\z/)
    namespace_id = Integer(input.fetch('namespaceId'))
    code, namespace = api.call(Net::HTTP::Get, "namespaces/#{namespace_id}")
    raise BootstrapError, 'Namespace lookup failed' unless code == 200
    full_path = namespace.fetch('full_path') + '/' + key
    encoded = URI.encode_www_form_component(full_path)
    code, project = api.call(Net::HTTP::Get, 'projects/' + encoded)
    raise BootstrapError, 'Project lookup failed' unless [200, 404].include?(code)
    if input['action'] == 'wizard-source'
      raise BootstrapError, 'Wizard repository missing' unless code == 200
      result = WizardSourceImport.new(api, input, project).call
    elsif input['action'] == 'pipeline'
      marker = 'System Bootstrapper operation ' + input.fetch('operation')
      raise BootstrapError, 'Cannot start pipeline for an unrelated project' unless code == 200 && project['description'] == marker
      branch = project.fetch('default_branch')
      file_code, ci_file = api.call(Net::HTTP::Get, "projects/#{project.fetch('id')}/repository/files/%2Esystem-bootstrapper%2Fci.yml?ref=#{URI.encode_www_form_component(branch)}")
      raise BootstrapError, 'Managed CI missing' unless file_code == 200
      sha = ci_file.fetch('last_commit_id')
      pipeline_code, pipelines = api.call(Net::HTTP::Get, "projects/#{project.fetch('id')}/pipelines?sha=#{sha}&ref=#{URI.encode_www_form_component(branch)}")
      raise BootstrapError, 'Pipeline lookup failed; retry Save' unless pipeline_code == 200
      pipeline = pipelines.find { |item| item['source'] == 'api' }
      unless pipeline
        pipeline_code, pipeline = api.call(Net::HTTP::Post, "projects/#{project.fetch('id')}/pipeline", {ref: branch})
        raise BootstrapError, "Pipeline start failed (HTTP #{pipeline_code}); retry Save" unless pipeline_code == 201
      end
      result = {pipeline: {id: pipeline.fetch('id'), webUrl: pipeline.fetch('web_url'), status: pipeline.fetch('status')}}
    elsif input['action'] == 'availability'
      result = {availability: code == 404 ? 'available' : 'occupied', path: full_path}
    else
      marker = 'System Bootstrapper operation ' + input.fetch('operation')
      if code == 200 && project['description'] != marker
        result = {state: 'failed', conflict: true, message: 'Repository already exists in the selected namespace.'}
      else
        if code == 404
          code, project = api.call(Net::HTTP::Post, 'projects', {
            name: key, path: key, namespace_id: namespace_id, visibility: 'private',
            description: marker, initialize_with_readme: true})
          unless code == 201
            # GitLab creation is authoritative, including a race after lookup.
            result = {state: 'failed', conflict: code == 400 || code == 409,
              message: "GitLab rejected project creation (HTTP #{code}); check namespace permissions, reserved names or a competing creation."}
          end
        end
        unless result
          raise BootstrapError, 'Unexpected project identity' unless project['path_with_namespace'] == full_path && project['visibility'] == 'private'
          branch = project['default_branch']
          raise BootstrapError, 'Default branch not ready; retry Save' if branch.to_s.empty?
          ci_path = '.system-bootstrapper/ci.yml'
          file_route = "projects/#{project.fetch('id')}/repository/files/#{URI.encode_www_form_component(ci_path)}?ref=#{URI.encode_www_form_component(branch)}"
          file_code, file = api.call(Net::HTTP::Get, file_route)
          raise BootstrapError, 'CI lookup failed' unless [200, 404].include?(file_code)
          # The existing generator uses the actual default branch at runtime.
          ci = input.fetch('ci')
          if file_code == 404
            commit_code, = api.call(Net::HTTP::Post, "projects/#{project.fetch('id')}/repository/commits", {
              branch: branch, commit_message: input['files'] ? 'Install application template and managed CI' : 'Install managed application CI [skip ci]',
              actions: [{action: 'create', file_path: ci_path, content: ci}] + (input['files'] || [])})
            raise BootstrapError, 'CI installation failed; retry Save' unless commit_code == 201
          elsif Base64.decode64(file.fetch('content')) != ci
            raise BootstrapError, 'Managed CI changed; refusing to overwrite repository content'
          end
          update_code, = api.call(Net::HTTP::Put, "projects/#{project.fetch('id')}", {ci_config_path: ci_path})
          raise BootstrapError, 'CI activation failed; retry Save' unless update_code == 200
          result = {repository: {id: project.fetch('id'), namespaceId: namespace_id,
            path: full_path, webUrl: project.fetch('web_url'), defaultBranch: branch,
            pipelineUrl: project.fetch('web_url') + '/-/pipelines', ciPath: ci_path,
            template: input['template'] || 'empty', templateVersion: input['templateVersion'], generatedCi: input['files'] ? ci : nil,
            deploymentState: input['files'] ? 'awaiting-pipeline' : 'awaiting-source'}}
        end
      end
    end
  end
rescue BootstrapError => error
  result = {state: 'failed', message: error.message}
rescue StandardError
  # Do not relay Rails/HTTP exceptions; they may include credentials or config.
  result = {state: 'failed', message: 'GitLab operation failed. Check readiness and namespace permissions, then retry Save.'}
ensure
  credential.revoke! if credential
end
puts JSON.generate(result)
