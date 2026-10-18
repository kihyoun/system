require 'digest'
class WizardBuildActivation
  CI_PATH = '.system-bootstrapper/ci.yml'
  MARKER_PATH = '.system-bootstrapper/wizard-build.json'
  REQUIRED_JOBS = ['build:wizard', 'test:wizard'].freeze
  def initialize(api, input, project)
    @api, @input, @project = api, input, project
    @recipe, @build, @workflow = input.fetch('recipe'), input.fetch('build'), input.fetch('workflow')
  end

  def call
    owned!
    # Session-scoped PostgreSQL advisory locks survive controller restarts and
    # release if this Rails process dies. No project row is locked across HTTP.
    lock = Digest::SHA256.hexdigest("system-wizard-build:#{@project.fetch('id')}:#{@build.fetch('operation')}")[0, 15].to_i(16)
    ActiveRecord::Base.connection_pool.with_connection do |connection|
      acquired = connection.select_value("SELECT pg_try_advisory_lock(#{lock})")
      raise BootstrapError, 'Wizard build operation is still running; refresh or retry shortly' unless acquired
      begin
        activate_or_status
      ensure
        connection.select_value("SELECT pg_advisory_unlock(#{lock})")
      end
    end
  end

  private

  def request(method, route, body = nil, expected = 200)
    code, result = @api.call(method, route, body)
    raise BootstrapError, 'Wizard build GitLab operation failed; retry to inspect the same operation' unless code == expected
    result
  end
  def prefix
    "projects/#{@project.fetch('id')}/"
  end
  def file(name)
    code, data = @api.call(Net::HTTP::Get, prefix + 'repository/files/' + URI.encode_www_form_component(name) + '?ref=' + URI.encode_www_form_component(@project.fetch('default_branch')))
    raise BootstrapError, 'Wizard build file lookup failed' unless [200, 404].include?(code)
    code == 200 ? data : nil
  end
  def decoded(row)
    Base64.strict_decode64(row.fetch('content').delete("\n"))
  end
  def owned!
    repository = @input.fetch('repository')
    raise BootstrapError, 'Wizard repository ownership changed' unless @project &&
      @project['id'] == repository.fetch('id') && @project['visibility'] == 'private' &&
      @project['description'] == 'System Bootstrapper operation ' + @input.fetch('operation') &&
      @project['path_with_namespace'] == repository.fetch('path') &&
      @project['default_branch'] == repository.fetch('defaultBranch') && @project['ci_config_path'] == CI_PATH
    raise BootstrapError, 'Invalid Wizard build reservation' unless @recipe['version'] == 1 && @build['version'] == 1 &&
      @build['recipeHash'] == @recipe['recipeHash'] && @build.fetch('operation').match?(/\A[a-f0-9]{48}\z/) &&
      @workflow.fetch('importCommit').match?(/\A[a-f0-9]{40}\z/)
    marker = file('.system-bootstrapper/wizard-source.json')
    expected = {version: 1, operation: @input.fetch('operation'), sourceRevision: @workflow.fetch('sourceRevision'), manifestHash: @workflow.fetch('manifestHash')}
    raise BootstrapError, 'Wizard source reservation changed' unless marker && decoded(marker) == JSON.generate(expected)
  end

  def activate_or_status
    marker_content = JSON.generate({version: 1, operation: @build.fetch('operation'), recipeHash: @recipe.fetch('recipeHash'),
      sourceRevision: @workflow.fetch('sourceRevision'), importCommit: @workflow.fetch('importCommit')})
    marker = file(MARKER_PATH)
    if marker
      raise BootstrapError, 'Wizard build marker changed; refusing overwrite' unless decoded(marker) == marker_content
      @recipe.fetch('files').each do |source|
        installed = file(source.fetch('path'))
        raise BootstrapError, 'Managed Wizard build recipe changed; use a reviewed upgrade' unless installed &&
          decoded(installed) == source.fetch('content') && installed.fetch('last_commit_id') == marker.fetch('last_commit_id')
      end
      ci = file(CI_PATH)
      raise BootstrapError, 'Managed Wizard CI changed; use a reviewed upgrade' unless ci && decoded(ci) == @recipe.fetch('ci') &&
        ci.fetch('last_commit_id') == marker.fetch('last_commit_id')
      commit = marker.fetch('last_commit_id')
    else
      return {build: @build, message: 'Build activation has not installed its recipe yet.'} if @input['action'] == 'wizard-build-status'
      branch = request(Net::HTTP::Get, prefix + 'repository/branches/' + URI.encode_www_form_component(@project.fetch('default_branch')))
      raise BootstrapError, 'Wizard source changed before build activation; review it first' unless branch.fetch('commit').fetch('id') == @workflow.fetch('importCommit')
      ci = file(CI_PATH)
      raise BootstrapError, 'Managed scaffold changed; refusing build activation' unless ci && decoded(ci) == @input.fetch('expectedCi')
      actions = @recipe.fetch('files').map do |source|
        raise BootstrapError, 'Wizard build recipe path is occupied; refusing overwrite' if file(source.fetch('path'))
        {action: 'create', file_path: source.fetch('path'), content: source.fetch('content')}
      end
      actions << {action: 'create', file_path: MARKER_PATH, content: marker_content}
      actions << {action: 'update', file_path: CI_PATH, content: @recipe.fetch('ci'), last_commit_id: ci.fetch('last_commit_id')}
      result = request(Net::HTTP::Post, prefix + 'repository/commits', {branch: @project.fetch('default_branch'),
        commit_message: 'Enable managed Wizard checks [skip ci]', actions: actions}, 201)
      commit = result.fetch('id')
    end
    installed_commit = request(Net::HTTP::Get, prefix + 'repository/commits/' + commit)
    raise BootstrapError, 'Wizard source raced recipe installation; review the existing commit before proceeding' unless installed_commit['parent_ids'] == [@workflow.fetch('importCommit')]
    raise BootstrapError, 'Wizard activation commit changed' if @build['activationCommit'] && @build['activationCommit'] != commit
    state = @build.merge('activationCommit' => commit, 'phase' => 'recipe-installed')
    pipeline = lookup_pipeline(commit)
    intent = creation_intent(commit)
    raise BootstrapError, 'Wizard pipeline has no managed creation checkpoint; inspect before continuing' if pipeline && !intent
    if !pipeline && intent
      return reconciliation(state)
    elsif !pipeline && @input['action'] == 'wizard-build'
      branch = request(Net::HTTP::Get, prefix + 'repository/branches/' + URI.encode_www_form_component(@project.fetch('default_branch')))
      raise BootstrapError, 'Wizard branch advanced before initial pipeline; review before retrying' unless branch.fetch('commit').fetch('id') == commit
      # A durable non-secret checkpoint is created BEFORE the external request.
      # Lost responses and process death must never cause a second blind POST.
      request(Net::HTTP::Post, prefix + 'variables', {key: intent_key, value: intent_value(commit),
        variable_type: 'env_var', environment_scope: '*', protected: false, masked: false}, 201)
      begin
        pipeline = request(Net::HTTP::Post, prefix + 'pipeline', {ref: @project.fetch('default_branch'), variables: [
          {key: 'SYSTEM_WIZARD_OPERATION', value: @build.fetch('operation')}, {key: 'SYSTEM_WIZARD_EXPECTED_SHA', value: commit}]}, 201)
      rescue StandardError
        return reconciliation(state)
      end
      raise BootstrapError, 'Wizard branch raced pipeline creation; refusing mismatched pipeline' unless pipeline.fetch('sha') == commit
    end
    return {build: state, message: 'Recipe installed; no initial pipeline has been started.'} unless pipeline
    evidence(pipeline, commit, state)
  end

  def intent_key
    'SYSTEM_WIZARD_PIPELINE_' + @build.fetch('operation')
  end
  def intent_value(commit)
    JSON.generate({version: 1, operation: @build.fetch('operation'), commit: commit})
  end
  def creation_intent(commit)
    code, variable = @api.call(Net::HTTP::Get, prefix + 'variables/' + intent_key + '?filter%5Benvironment_scope%5D=%2A')
    raise BootstrapError, 'Wizard pipeline checkpoint lookup failed' unless [200, 404].include?(code)
    return nil if code == 404
    raise BootstrapError, 'Wizard pipeline checkpoint changed; inspect before continuing' unless variable['value'] == intent_value(commit) &&
      variable['key'] == intent_key && variable['environment_scope'] == '*' && variable['variable_type'] == 'env_var'
    variable
  end
  def reconciliation(state)
    {build: state.merge('phase' => 'requires-reconciliation'), message:
      'The initial pipeline request may already have been submitted. Refresh only; no second request will be sent. ' +
      'If no pipeline appears, an administrator must inspect the recorded operation and GitLab state before any explicit repair. Do not clear the checkpoint blindly.'}
  end

  def lookup_pipeline(commit)
    if @build['pipeline']
      pipeline = request(Net::HTTP::Get, prefix + 'pipelines/' + Integer(@build.fetch('pipeline').fetch('id')).to_s)
      validate_pipeline!(pipeline, commit)
      return pipeline
    end
    matches = []
    page = 1
    loop do
      rows = request(Net::HTTP::Get, prefix + 'pipelines?ref=' + URI.encode_www_form_component(@project.fetch('default_branch')) + '&source=api&per_page=100&page=' + page.to_s)
      rows.each do |pipeline|
        variables = request(Net::HTTP::Get, prefix + 'pipelines/' + pipeline.fetch('id').to_s + '/variables')
        next unless variables.any? { |row| row['key'] == 'SYSTEM_WIZARD_OPERATION' && row['value'] == @build.fetch('operation') }
        validate_pipeline!(pipeline, commit)
        matches << pipeline
      end
      break if rows.length < 100
      page += 1
      raise BootstrapError, 'Too many pipelines to inspect safely; inspect the existing operation' if page > 20
    end
    raise BootstrapError, 'Multiple initial Wizard pipelines found; inspect before retrying' if matches.length > 1
    matches.first
  end
  def validate_pipeline!(pipeline, commit)
    raise BootstrapError, 'Wizard pipeline identity changed' unless pipeline['sha'] == commit && pipeline['source'] == 'api' &&
      pipeline['ref'] == @project.fetch('default_branch') && pipeline['id'].is_a?(Integer)
  end
  def evidence(pipeline, commit, state)
    validate_pipeline!(pipeline, commit)
    jobs = request(Net::HTTP::Get, prefix + 'pipelines/' + pipeline.fetch('id').to_s + '/jobs?per_page=100')
    selected = REQUIRED_JOBS.map { |name| jobs.find { |job| job['name'] == name } }
    state['pipeline'] = {id: pipeline.fetch('id'), sha: commit, status: pipeline.fetch('status'), webUrl: pipeline.fetch('web_url')}
    state['checks'] = REQUIRED_JOBS.each_with_index.to_h { |name, index| [name, selected[index]&.fetch('status', 'missing') || 'missing'] }
    state.delete('artifact')
    state['phase'] = 'pipeline-running'
    state['phase'] = 'checks-failed' if ['failed', 'canceled', 'skipped', 'manual'].include?(pipeline['status'])
    if pipeline['status'] == 'success'
      raise BootstrapError, 'Wizard required checks did not succeed' unless selected.all? { |job| job && job['status'] == 'success' && job['allow_failure'] == false }
      build = artifact(selected[0], 'build-evidence.json', commit, pipeline.fetch('id'))
      smoke = artifact(selected[1], 'wizard-evidence.json', commit, pipeline.fetch('id'))
      raise BootstrapError, 'Wizard artifact checks are incomplete' unless (build['jest'] == true || (build['unitTests'] == true && build['testRunner'] == 'vitest' &&
        build['lint'] == true && build['typecheck'] == true)) && build['productionBuild'] == true &&
        ['http', 'renderedUI', 'projects', 'spa'].all? { |key| smoke[key] == true } &&
        (build['testRunner'] != 'vitest' || ['configurationBackup', 'cubeSignature'].all? { |key| smoke[key] == true }) &&
        build['imageRef'] == smoke['imageRef']
      state['artifact'] = {imageRef: build.fetch('imageRef'), sourceCommit: commit, pipelineId: pipeline.fetch('id')}
      state['phase'] = 'candidate-verified'
    end
    {build: state, message: state['phase'] == 'candidate-verified' ? 'Wizard checks and candidate artifact verified. Production remains unchanged.' : 'Wizard pipeline status refreshed. Production remains unchanged.'}
  end
  def artifact(job, name, commit, pipeline)
    data = request(Net::HTTP::Get, prefix + 'jobs/' + job.fetch('id').to_s + '/artifacts/' + name)
    expected = Regexp.escape(@input.fetch('registryPrefix')) + '@sha256:[a-f0-9]{64}'
    raise BootstrapError, 'Wizard artifact identity or digest is invalid' unless data['version'] == 1 && data['sourceCommit'] == commit &&
      data['pipelineId'] == pipeline && data.fetch('imageRef', '').match?(/\A#{expected}\z/)
    data
  end
end
