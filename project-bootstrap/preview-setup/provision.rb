# Native GitLab adapter. The outer provisioner creates and revokes its temporary
# administrator credential; source transfer receives only an expiring project PAT.
require 'digest'
class BootstrapperPreviewSetup
  def initialize(api, input)
    @api, @input = api, input
  end
  def api(method, route, body = nil, missing = false)
    code, value = @api.call(method, route, body)
    return nil if missing && code == 404
    raise BootstrapError, 'Preview setup GitLab request failed; verify readiness, permissions and the recorded operation.' unless [200, 201, 204].include?(code)
    value
  end
  def get(route, missing = false)
    api(Net::HTTP::Get, route, nil, missing)
  end
  def runners(route)
    get(route).select { |row| row['paused'] == false && row['status'] == 'online' }.map { |row| get("runners/#{row.fetch('id')}") }
  end
  def namespace
    rows = get('namespaces?per_page=100')
    row = rows.find { |value| value['full_path'] == @input.fetch('namespace') }
    raise BootstrapError, 'The selected namespace is missing or inaccessible.' unless row
    row
  end
  def marker
    'System Bootstrapper preview setup ' + @input.fetch('operation')
  end
  def owned(project)
    raise BootstrapError, 'Preview source ownership changed; existing operator projects are never overwritten.' unless project['description'] == marker && project['visibility'] == 'private'
  end
  def variable(project, key, value)
    prefix = "projects/#{project.fetch('id')}/variables"
    current = get(prefix + '/' + key + '?filter%5Benvironment_scope%5D=*', true)
    if current
      raise BootstrapError, 'A preview setup variable conflicts with operator settings.' unless current['value'] == value && current['environment_scope'] == '*' && current['raw'] == true && current['protected'] == false && current['masked'] == false
    else
      api(Net::HTTP::Post, prefix, {key: key, value: value, environment_scope: '*', raw: true, protected: false, masked: false})
    end
  end
  def evidence_routes(routes)
    ids = @input.fetch('projectIds').map { |id| Integer(id) }
    raise BootstrapError, 'Invalid preview evidence route.' unless routes.is_a?(Array) && routes.length.between?(1, 32)
    # Validate the complete batch before making its first request. An invalid
    # later member must not read even an otherwise permitted project.
    routes.each do |route|
      match = route.is_a?(String) && route.bytesize <= 2048 &&
        %r{\Aprojects/([1-9][0-9]*)(?:\z|/(?:repository/(?:branches/|files/|tree\?)|pipelines(?:/|\?)|jobs/[1-9][0-9]*/artifacts/))}.match(route)
      raise BootstrapError, 'Invalid preview evidence route.' unless match && ids.include?(Integer(match[1])) && !route.match?(/[\x00-\x20\x7f]/) && !route.include?('..')
    end
    routes
  end
  def evidence_reader(recorded = nil)
    reads, bytes = 0, 32
    lambda do |route|
      evidence_routes([route])
      reads += 1
      raise BootstrapError, 'Invalid preview evidence route.' if reads > 32
      value = get(route)
      bytes += JSON.generate(value).bytesize + 1
      raise BootstrapError, 'Preview setup GitLab request failed; verify readiness, permissions and the recorded operation.' if bytes > 1500000
      recorded << {route: route, value: value} if recorded
      value
    end
  end
  def evidence_result(value)
    raise BootstrapError, 'Preview setup GitLab request failed; verify readiness, permissions and the recorded operation.' if JSON.generate(value).bytesize > 1500000
    value
  end
  def source_context(read = evidence_reader)
    id = @input.fetch('projectId')
    ids = @input['projectIds']
    raise BootstrapError, 'Invalid preview evidence route.' unless id.is_a?(Integer) && id > 0 && ids.is_a?(Array) && ids.include?(id)
    prefix = "projects/#{id}"
    project = read.call(prefix)
    branch_name = project.fetch('default_branch')
    raise BootstrapError, 'Selected preview source identity is invalid.' unless project['id'] == id && branch_name.is_a?(String) && !branch_name.empty?
    branch = read.call(prefix + '/repository/branches/' + URI.encode_www_form_component(branch_name))
    sha = branch.fetch('commit').fetch('id')
    raise BootstrapError, 'Selected preview source identity is invalid.' unless sha.is_a?(String) && sha.match?(/\A[a-f0-9]{40}\z/)
    pipelines = read.call(prefix + '/pipelines?sha=' + sha + '&ref=' + URI.encode_www_form_component(branch_name) + '&source=push&per_page=100')
    pipeline = pipelines.find { |row| row['sha'] == sha && row['source'] == 'push' }
    result = {project: project, branch: branch, pipeline: pipeline}
    return evidence_result(result) unless pipeline && ['success', 'failed'].include?(pipeline['status'])
    pipeline_id = pipeline.fetch('id')
    raise BootstrapError, 'Selected preview source identity is invalid.' unless pipeline_id.is_a?(Integer) && pipeline_id > 0
    result[:jobs] = read.call(prefix + "/pipelines/#{pipeline_id}/jobs?per_page=100&include_retried=false")
    result[:trees] = ['.gitlab', '.system-bootstrapper/build-v1'].map do |directory|
      rows = read.call(prefix + '/repository/tree?path=' + URI.encode_www_form_component(directory) + '&ref=' + sha + '&recursive=true&per_page=100')
      raise BootstrapError, 'The approved CI manifest is too large. Review it through the native source-primary tool.' if rows.length >= 100
      rows
    end
    evidence_result(result)
  end
  # Mirror the native binding gate before reading any artifact. JavaScript
  # independently repeats these checks on the returned fresh phase response.
  def pipeline_checks(pipeline, jobs)
    states = ['created', 'pending', 'running', 'success', 'failed', 'canceled', 'manual', 'scheduled', 'waiting_for_resource', 'preparing']
    raise BootstrapError, 'Native Wizard pipeline state is invalid.' unless states.include?(pipeline['status']) && jobs.is_a?(Array)
    ['build:source', 'test:browser', 'build:wizard', 'test:wizard'].each do |name|
      found = jobs.select { |job| job['name'] == name }
      raise BootstrapError, 'All required native source and delivery checks must succeed.' unless found.length == 1 &&
        found[0]['status'] == 'success' && found[0]['allow_failure'] == false &&
        found[0].dig('commit', 'id') == pipeline['sha'] && found[0].dig('pipeline', 'id') == pipeline['id']
    end
    publishers = jobs.select { |job| job['name'] == 'deploy:github' }
    publisher = publishers.first
    raise BootstrapError, 'Public mirror job identity changed.' if publishers.length > 1 || publisher &&
      (publisher['allow_failure'] != false || publisher.dig('commit', 'id') != pipeline['sha'] || publisher.dig('pipeline', 'id') != pipeline['id'])
    failures = jobs.select { |job| job['allow_failure'] == false && job['name'] != 'deploy:github' && job['status'] != 'success' }
    raise BootstrapError, 'Native Wizard pipeline failed outside the optional public mirror.' unless failures.empty? &&
      (pipeline['status'] == 'success' || publisher && publisher['status'] != 'success')
  end
  def source_evidence
    read = evidence_reader
    result = source_context(read)
    pipeline = result[:pipeline]
    return result unless pipeline && ['success', 'failed'].include?(pipeline['status'])
    pipeline_checks(pipeline, result.fetch(:jobs))
    blobs = result.fetch(:trees).flatten.select { |row| row['type'] == 'blob' }
    # Larger valid manifests keep the existing bounded multi-process path.
    return result if blobs.length + 7 > 32
    prefix = "projects/#{@input.fetch('projectId')}"
    sha = result.fetch(:branch).fetch('commit').fetch('id')
    jobs = result.fetch(:jobs)
    artifact = prefix + "/jobs/#{jobs.find { |job| job['name'] == 'build:wizard' }.fetch('id')}/artifacts/build-evidence.json"
    routes = blobs.map { |row| prefix + '/repository/files/' + URI.encode_www_form_component(row.fetch('path')) + '?ref=' + sha }
    evidence_routes([artifact, *routes])
    result[:artifact] = read.call(artifact)
    result[:files] = blobs.zip(routes).map { |row, route| {path: row.fetch('path'), value: read.call(route)} }
    evidence_result(result)
  end
  def adoption_evidence
    receipt = @input.fetch('receipt')
    repository, binding = receipt.fetch('repository'), receipt.fetch('sourcePrimary')
    id, previous = repository.fetch('id'), @input.fetch('previousProjectId')
    pipeline_id, sha = @input.fetch('pipelineId'), @input.fetch('sourceCommit')
    files = binding.fetch('ciFiles')
    raise BootstrapError, 'Invalid preview evidence route.' unless [id, previous, pipeline_id, receipt['namespaceId']].all? { |value| value.is_a?(Integer) && value > 0 } &&
      repository['namespaceId'] == receipt['namespaceId'] && repository['managementMode'] == 'source-primary' && repository['ciPath'] == '.gitlab/primary.yml' &&
      repository['path'].is_a?(String) && repository['defaultBranch'].is_a?(String) && sha.is_a?(String) && sha.match?(/\A[a-f0-9]{40}\z/) &&
      files.is_a?(Array) && files.length.between?(1, 25) && files.map { |file| file['path'] }.uniq.length == files.length &&
      files.any? { |file| file['path'] == '.gitlab/primary.yml' } && files.all? { |file| file['path'].is_a?(String) &&
        file['path'].match?(%r{\A(?:\.gitlab|\.system-bootstrapper)/[A-Za-z0-9_./-]+\z}) && !file['path'].split('/').include?('..') &&
        file['sha256'].is_a?(String) && file['sha256'].match?(/\A[a-f0-9]{64}\z/) }
    prefix = "projects/#{id}"
    routes = ["projects/#{previous}", prefix + '/repository/branches/' + URI.encode_www_form_component(repository.fetch('defaultBranch')),
      prefix, prefix + "/pipelines/#{pipeline_id}", prefix + "/pipelines/#{pipeline_id}/jobs?per_page=100&include_retried=false",
      *files.map { |file| prefix + '/repository/files/' + URI.encode_www_form_component(file.fetch('path')) + '?ref=' + sha }]
    evidence_routes(routes)
    recorded = []
    read = evidence_reader(recorded)
    read.call(routes[0])
    branch = read.call(routes[1])
    project = read.call(routes[2])
    pipeline = read.call(routes[3])
    jobs = read.call(routes[4])
    raise BootstrapError, 'Canonical source-primary project identity or merge gates changed.' unless project['id'] == id &&
      project['path_with_namespace'] == repository['path'] && project.dig('namespace', 'id') == receipt['namespaceId'] &&
      project['default_branch'] == repository['defaultBranch'] && project['visibility'] == 'private' && project['ci_config_path'] == '.gitlab/primary.yml' &&
      project['only_allow_merge_if_pipeline_succeeds'] == true && project['only_allow_merge_if_all_discussions_are_resolved'] == true
    raise BootstrapError, 'Require the exact successful native default-branch push pipeline.' unless branch.dig('commit', 'id') == sha &&
      pipeline['id'] == pipeline_id && pipeline['sha'] == sha && pipeline['ref'] == repository['defaultBranch'] &&
      pipeline['source'] == 'push' && [nil, false, '', 0].include?(pipeline['yaml_errors'])
    pipeline_checks(pipeline, jobs)
    files.zip(routes.drop(5)).each do |file, route|
      value = read.call(route)
      content = Base64.strict_decode64(value.fetch('content').delete("\n"))
      raise BootstrapError, 'Approved native Wizard CI changed.' unless Digest::SHA256.hexdigest(content) == file.fetch('sha256')
    end
    ['build:wizard', 'test:wizard'].zip(['build-evidence.json', 'wizard-evidence.json']).each do |name, filename|
      job = jobs.find { |value| value['name'] == name }
      read.call(prefix + "/jobs/#{job.fetch('id')}/artifacts/#{filename}")
    end
    evidence_result({reads: recorded})
  end
  def call
    case @input.fetch('action')
    when 'preview-setup-preflight'
      selected = namespace
      available_runners = runners('runners/all?per_page=100&status=online')
      raise BootstrapError, 'An online Docker runner with wizard-source-primary access is required.' unless available_runners.any? { |row| ['docker', 'wizard-source-primary'].all? { |tag| row.fetch('tag_list', []).include?(tag) } }
      @input.fetch('sources').each do |source|
        project = get('projects/' + URI.encode_www_form_component(selected.fetch('full_path') + '/' + source.fetch('project')), true)
        if source.fetch('mode') == 'import'
          raise BootstrapError, 'The selected import project is occupied. Choose a new project or explicitly select an existing source.' if project && project['description'] != marker
        else
          raise BootstrapError, 'Select an existing private source with its native CI and merge gates enabled.' unless project && project['visibility'] == 'private' && project['ci_config_path'] == source.fetch('ciPath') && project['only_allow_merge_if_pipeline_succeeds'] == true && project['only_allow_merge_if_all_discussions_are_resolved'] == true
          available = runners("projects/#{project.fetch('id')}/runners?per_page=100")
          raise BootstrapError, 'The selected source project has no online permitted Docker runner.' unless available.any? { |row| row['status'] == 'online' && row['paused'] == false && row.fetch('tag_list', []).include?('docker') }
        end
      end
      {namespaceId: selected.fetch('id'), runnerReady: true}
    when 'preview-setup-project'
      selected = namespace
      source = @input.fetch('source')
      project = get('projects/' + URI.encode_www_form_component(selected.fetch('full_path') + '/' + source.fetch('project')), true)
      if source.fetch('mode') == 'import'
        unless project
          project = api(Net::HTTP::Post, 'projects', {name: source.fetch('project'), path: source.fetch('project'), namespace_id: selected.fetch('id'), visibility: 'private', description: marker, initialize_with_readme: false, auto_devops_enabled: false, ci_config_path: source.fetch('ciPath'), only_allow_merge_if_pipeline_succeeds: true, only_allow_merge_if_all_discussions_are_resolved: true})
        end
        owned(project)
        # New operator forks never inherit an upstream publication opt-in.
        ['GITHUB_BACKUP_ENABLED', 'DOCKERHUB_PUBLISH_ENABLED', 'GITHUB_RELEASE_PUBLISH_ENABLED', 'WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED'].each { |key| variable(project, key, 'false') }
      else
        raise BootstrapError, 'Existing source identity or native merge gates changed.' unless project && project['visibility'] == 'private' && project['ci_config_path'] == source.fetch('ciPath') && project['only_allow_merge_if_pipeline_succeeds'] == true && project['only_allow_merge_if_all_discussions_are_resolved'] == true
      end
      available = runners("projects/#{project.fetch('id')}/runners?per_page=100")
      required = source.fetch('ciPath') == '.gitlab/primary.yml' ? ['docker', 'wizard-source-primary'] : ['docker']
      raise BootstrapError, 'The selected project has no permitted online runner for its native checks.' unless available.any? { |row| row['status'] == 'online' && row['paused'] == false && required.all? { |tag| row.fetch('tag_list', []).include?(tag) } }
      variable(project, 'WIZARD_DELIVERY_ENABLED', 'true') if source.fetch('ciPath') == '.gitlab/primary.yml'
      if source.fetch('mode') == 'import'
        token = api(Net::HTTP::Post, "projects/#{project.fetch('id')}/access_tokens", {name: 'bootstrapper-preview-source-' + @input.fetch('operation'), scopes: ['write_repository'], access_level: 40, expires_at: Date.tomorrow.to_s})
        {project: project, credential: {id: token.fetch('id'), token: token.fetch('token')}}
      else
        {project: project}
      end
    when 'preview-setup-revoke'
      project = get('projects/' + Integer(@input.fetch('projectId')).to_s)
      owned(project)
      api(Net::HTTP::Delete, "projects/#{project.fetch('id')}/access_tokens/#{Integer(@input.fetch('tokenId'))}")
      {revoked: true}
    when 'preview-setup-read'
      {value: get(evidence_routes([@input.fetch('route')]).first)}
    when 'preview-setup-source-context'
      source_context
    when 'preview-setup-source-evidence'
      source_evidence
    when 'preview-setup-adoption-evidence'
      adoption_evidence
    when 'preview-setup-read-many'
      routes = evidence_routes(@input.fetch('routes'))
      bytes = 32
      values = routes.map do |route|
        value = get(route)
        bytes += JSON.generate(value).bytesize + 1
        raise BootstrapError, 'Preview setup GitLab request failed; verify readiness, permissions and the recorded operation.' if bytes > 1500000
        value
      end
      {values: values}
    when 'preview-setup-system'
      project = get('projects/' + Integer(@input.fetch('projectId')).to_s)
      raise BootstrapError, 'Selected System source identity changed.' unless project['path_with_namespace'] == @input.fetch('projectPath') && project.dig('namespace', 'id') == Integer(@input.fetch('namespaceId')) && project['only_allow_merge_if_pipeline_succeeds'] == true && project['only_allow_merge_if_all_discussions_are_resolved'] == true
      variable(project, 'SYSTEM_REVIEW_ENABLED', 'true')
      variable(project, 'WIZARD_REVIEW_HOST', @input.fetch('reviewHost'))
      {ready: true}
    else
      raise BootstrapError, 'Unsupported native preview setup action.'
    end
  end
end
