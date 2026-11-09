# Native GitLab adapter. The outer provisioner creates and revokes its temporary
# administrator credential; source transfer receives only an expiring project PAT.
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
      route = @input.fetch('route')
      ids = @input.fetch('projectIds').map { |id| Integer(id) }
      match = %r{\Aprojects/([1-9][0-9]*)(?:\z|/(?:repository/(?:branches/|files/|tree\?)|pipelines(?:/|\?)|jobs/[1-9][0-9]*/artifacts/))}.match(route)
      raise BootstrapError, 'Invalid preview evidence route.' unless match && ids.include?(Integer(match[1])) && !route.include?("\n") && !route.include?('..')
      {value: get(route)}
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
