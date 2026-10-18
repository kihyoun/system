require 'digest'
class WizardEnvironmentsAdapter
  CI_PATH = '.system-bootstrapper/ci.yml'
  MARKER_PATH = '.system-bootstrapper/wizard-environments.json'
  def initialize(api, input, project)
    @api, @input, @project = api, input, project
    @environment, @recipe = input.fetch('environments'), input.fetch('recipe')
  end
  def call
    owned!
    key = Digest::SHA256.hexdigest("system-wizard-environments:#{@project.fetch('id')}")[0, 15].to_i(16)
    ActiveRecord::Base.connection_pool.with_connection do |connection|
      raise BootstrapError, 'Wizard environment operation is busy; retry shortly' unless connection.select_value("SELECT pg_try_advisory_lock(#{key})")
      begin
        install_or_status
      ensure
        connection.select_value("SELECT pg_advisory_unlock(#{key})")
      end
    end
  end
  private
  def request(method, path, body = nil, expected = 200)
    code, result = @api.call(method, path, body)
    raise BootstrapError, 'Wizard environment GitLab request failed; refresh the same operation' unless code == expected
    result
  end
  def prefix
    "projects/#{@project.fetch('id')}/"
  end
  def file(name)
    code, result = @api.call(Net::HTTP::Get, prefix + 'repository/files/' + URI.encode_www_form_component(name) + '?ref=' + URI.encode_www_form_component(@project.fetch('default_branch')))
    raise BootstrapError, 'Managed environment file lookup failed' unless [200, 404].include?(code)
    code == 200 ? result : nil
  end
  def text(row)
    Base64.strict_decode64(row.fetch('content').delete("\n"))
  end
  def marker_fields(environment, recipe)
    {'version' => 1, 'operation' => environment.fetch('operation'), 'recipeHash' => recipe.fetch('recipeHash'),
      'settingsHash' => environment.fetch('settingsHash'), 'helperImage' => environment.fetch('helperImage'), 'controller' => environment.fetch('controller')}
  end
  def marker_matches?(row, environment, recipe)
    return false unless row
    parsed = JSON.parse(text(row))
    parsed.reject { |key, _| key == 'parentCommit' } == marker_fields(environment, recipe) && parsed.fetch('parentCommit', '').match?(/\A[a-f0-9]{40}\z/)
  rescue JSON::ParserError
    false
  end
  def verified_marker!(row, environment, recipe, commit = nil)
    raise BootstrapError, 'Managed environment marker changed; refusing overwrite' unless marker_matches?(row, environment, recipe) &&
      (!commit || row.fetch('last_commit_id') == commit)
    installed = request(Net::HTTP::Get, prefix + 'repository/commits/' + row.fetch('last_commit_id'))
    raise BootstrapError, 'Wizard branch raced environment installation; inspect the existing commit' unless
      installed['parent_ids'] == [JSON.parse(text(row)).fetch('parentCommit')]
    row
  end
  def matching!(name, expected, commit = nil)
    row = file(name)
    raise BootstrapError, 'Managed environment content changed; refusing overwrite' unless row && text(row) == expected && (!commit || row.fetch('last_commit_id') == commit)
    row
  end
  def owned!
    repository = @input.fetch('repository')
    raise BootstrapError, 'Wizard repository ownership changed' unless @project && @project['id'] == repository.fetch('id') &&
      @project['path_with_namespace'] == repository.fetch('path') && @project['default_branch'] == repository.fetch('defaultBranch') &&
      @project['visibility'] == 'private' && @project['description'] == 'System Bootstrapper operation ' + @input.fetch('operation') &&
      @project['ci_config_path'] == CI_PATH
    raise BootstrapError, 'Invalid environment reservation' unless @environment['version'] == 1 && @recipe['version'] == 1 &&
      @environment.fetch('operation').match?(/\A[a-f0-9]{48}\z/) && @environment['recipeHash'] == @recipe['recipeHash'] &&
      @environment['settingsHash'] == @recipe['settingsHash'] && @environment['helperImage'] == @recipe['helperImage'] &&
      @environment['controller'] == 'system_bootstrapper_1' && @input['controller'] == 'system_bootstrapper_1'
    workflow = @input.fetch('workflow')
    expected = JSON.generate({version: 1, operation: @input.fetch('operation'), sourceRevision: workflow.fetch('sourceRevision'), manifestHash: workflow.fetch('manifestHash')})
    matching!('.system-bootstrapper/wizard-source.json', expected)
    build = @input.fetch('build')
    legacy = @input.fetch('legacyRecipe')
    raise BootstrapError, 'A verified managed Wizard build is required' unless build['version'] == 1 && build['recipeHash'] == legacy['recipeHash'] &&
      build['activationCommit'].to_s.match?(/\A[a-f0-9]{40}\z/) && build['phase'] == 'candidate-verified' &&
      build.dig('artifact', 'imageRef').to_s.match?(/\A#{Regexp.escape(@input.fetch('registryPrefix'))}@sha256:[a-f0-9]{64}\z/)
    expected_build = JSON.generate({version: 1, operation: build.fetch('operation'), recipeHash: legacy.fetch('recipeHash'),
      sourceRevision: workflow.fetch('sourceRevision'), importCommit: workflow.fetch('importCommit')})
    matching!('.system-bootstrapper/wizard-build.json', expected_build, build.fetch('activationCommit'))
    legacy.fetch('files').each { |source| matching!(source.fetch('path'), source.fetch('content'), build.fetch('activationCommit')) }
  end
  def install_or_status
    current_marker = file(MARKER_PATH)
    if marker_matches?(current_marker, @environment, @recipe)
      verified_marker!(current_marker, @environment, @recipe)
      commit = current_marker.fetch('last_commit_id')
      matching!(CI_PATH, @recipe.fetch('ci'), commit)
      @recipe.fetch('files').each { |source| matching!(source.fetch('path'), source.fetch('content'), commit) }
      raise BootstrapError, 'Wizard environment activation identity changed' if @environment['activationCommit'] && @environment['activationCommit'] != commit
      return installed(commit)
    end
    return {environments: @environment, message: 'Environment recipe has not been installed.'} if @input['action'] == 'wizard-environments-status' && !current_marker
    previous = @input['previousEnvironments']
    previous_recipe = @input['previousRecipe']
    if previous
      raise BootstrapError, 'Previous environment checkpoint is incomplete' unless previous_recipe && previous['activationCommit'] &&
        previous['recipeHash'] == previous_recipe['recipeHash'] && previous['settingsHash'] == previous_recipe['settingsHash']
      slots = previous.fetch('deployments', {})
      raise BootstrapError, 'Stop active and reconcile pending environments before settings updates' if slots.values.any? { |slot| slot['active'] || slot['pending'] }
      verified_marker!(current_marker, previous, previous_recipe, previous.fetch('activationCommit'))
      ci = matching!(CI_PATH, previous_recipe.fetch('ci'), previous.fetch('activationCommit'))
      previous_recipe.fetch('files').each { |source| matching!(source.fetch('path'), source.fetch('content'), previous.fetch('activationCommit')) }
      raise BootstrapError, 'Unsupported managed environment recipe path migration' unless previous_recipe.fetch('files').map { |f| f.fetch('path') }.sort == @recipe.fetch('files').map { |f| f.fetch('path') }.sort
    else
      raise BootstrapError, 'Environment path occupied; refusing overwrite' if current_marker
      ci = matching!(CI_PATH, @input.fetch('legacyRecipe').fetch('ci'), @input.fetch('build').fetch('activationCommit'))
      @recipe.fetch('files').each { |source| raise BootstrapError, 'Environment recipe path occupied; refusing overwrite' if file(source.fetch('path')) }
    end
    return {environments: @environment, message: 'Environment upgrade is pending explicit activation.'} if @input['action'] == 'wizard-environments-status'
    branch = request(Net::HTTP::Get, prefix + 'repository/branches/' + URI.encode_www_form_component(@project.fetch('default_branch')))
    head = branch.fetch('commit').fetch('id')
    raise BootstrapError, 'Invalid Wizard branch identity' unless head.match?(/\A[a-f0-9]{40}\z/)
    expected_marker = JSON.generate(marker_fields(@environment, @recipe).merge('parentCommit' => head))
    actions = @recipe.fetch('files').map do |source|
      action = {action: previous ? 'update' : 'create', file_path: source.fetch('path'), content: source.fetch('content')}
      action[:last_commit_id] = file(source.fetch('path')).fetch('last_commit_id') if previous
      action
    end
    actions << {action: current_marker ? 'update' : 'create', file_path: MARKER_PATH, content: expected_marker}.tap { |a| a[:last_commit_id] = current_marker.fetch('last_commit_id') if current_marker }
    actions << {action: 'update', file_path: CI_PATH, content: @recipe.fetch('ci'), last_commit_id: ci.fetch('last_commit_id')}
    begin
      result = request(Net::HTTP::Post, prefix + 'repository/commits', {branch: @project.fetch('default_branch'),
        commit_message: 'Configure managed Wizard candidate environments [skip ci]', actions: actions}, 201)
    rescue StandardError
      return {environments: @environment.merge('phase' => 'requires-reconciliation'),
        message: 'Environment recipe commit may have completed. Refresh the same reservation before retrying.'}
    end
    commit = result.fetch('id')
    installed = request(Net::HTTP::Get, prefix + 'repository/commits/' + commit)
    raise BootstrapError, 'Wizard branch raced environment installation; inspect the existing commit' unless installed['parent_ids'] == [head]
    installed(commit)
  end
  def installed(commit)
    {environments: @environment.merge('activationCommit' => commit, 'phase' => 'recipe-installed'),
      message: 'Managed environment recipe installed. No pipeline was started; candidate deployment remains manual.'}
  end
end
