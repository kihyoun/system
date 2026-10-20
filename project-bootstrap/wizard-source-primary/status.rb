# Included only by the local provisioning runner; its temporary credential is
# owned and revoked by provision.rb. This operation never creates a pipeline.
require 'digest'
class WizardSourcePrimaryStatus
  def initialize(api, input, project)
    @api, @input, @project = api, input, project
  end
  def get(route)
    code, value = @api.call(Net::HTTP::Get, route)
    raise BootstrapError, 'Native Wizard evidence lookup failed' unless code == 200
    value
  end
  def call
    r = @input.fetch('repository'); binding = @input.fetch('sourcePrimary'); prefix = "projects/#{r.fetch('id')}/"
    raise BootstrapError, 'Source-primary Wizard binding changed' unless r['managementMode'] == 'source-primary' &&
      r['ciPath'] == '.gitlab/primary.yml' && binding['version'] == 1 &&
      @project['id'] == r['id'] && @project['path_with_namespace'] == r['path'] &&
      @project.dig('namespace', 'id') == @input.fetch('namespaceId') && @project['default_branch'] == r['defaultBranch'] &&
      @project['visibility'] == 'private' && @project['ci_config_path'] == r['ciPath'] &&
      @project['only_allow_merge_if_pipeline_succeeds'] == true && @project['only_allow_merge_if_all_discussions_are_resolved'] == true
    head = get(prefix + 'repository/branches/' + URI.encode_www_form_component(r.fetch('defaultBranch'))).dig('commit', 'id')
    rows = get(prefix + 'pipelines?ref=' + URI.encode_www_form_component(r.fetch('defaultBranch')) + '&sha=' + head + '&source=push&per_page=100')
    pipeline = rows.select { |p| p['sha'] == head && p['source'] == 'push' }.max_by { |p| p.fetch('id') }
    unless pipeline
      return {sourceRevision: head, build: {'version' => 1, 'mode' => 'source-primary', 'phase' => 'pending',
        'pipeline' => pipeline && pipeline.slice('id', 'sha', 'status', 'web_url'), 'recipeHash' => @input.fetch('build').fetch('recipeHash')},
        message: 'The current default branch has no successful native delivery pipeline yet.'}
    end
    files = binding.fetch('ciFiles')
    raise BootstrapError, 'Native Wizard CI manifest is invalid' unless files.is_a?(Array) && files.any? { |f| f['path'] == r['ciPath'] } && files.map { |f| f['path'] }.uniq.length == files.length
    files.each do |source|
      raise BootstrapError, 'Invalid native Wizard CI path' unless source.fetch('path').match?(%r{\A(?:\.gitlab|\.system-bootstrapper)/[A-Za-z0-9_./-]+\z}) && !source['path'].split('/').include?('..')
      file = get(prefix + 'repository/files/' + URI.encode_www_form_component(source.fetch('path')) + '?ref=' + head)
      raise BootstrapError, 'Approved native Wizard CI changed' unless Digest::SHA256.hexdigest(Base64.strict_decode64(file.fetch('content').delete("\n"))) == source.fetch('sha256')
    end
    jobs = get(prefix + "pipelines/#{pipeline.fetch('id')}/jobs?per_page=100&include_retried=false")
    ['build:source', 'test:browser', 'build:wizard', 'test:wizard'].each do |name|
      matches = jobs.select { |j| j['name'] == name }; job = matches.first
      raise BootstrapError, 'Required native source and delivery check identity changed' unless matches.length == 1 && job['allow_failure'] == false && job.dig('commit', 'id') == head && job.dig('pipeline', 'id') == pipeline['id']
      if ['created', 'pending', 'running', 'waiting_for_resource', 'preparing', 'scheduled'].include?(job['status'])
        return {sourceRevision: head, build: {'version' => 1, 'mode' => 'source-primary', 'phase' => 'pending',
          'pipeline' => pipeline.slice('id', 'sha', 'status', 'web_url'), 'recipeHash' => @input.fetch('build').fetch('recipeHash')}, message: 'Native source and delivery checks are still running.'}
      end
      raise BootstrapError, 'Required native source and delivery checks must succeed' unless job['status'] == 'success'
    end
    publishers = jobs.select { |j| j['name'] == 'deploy:github' }; publisher = publishers.first
    raise BootstrapError, 'Native public mirror identity changed' if publishers.length > 1 || (publisher &&
      (publisher['allow_failure'] != false || publisher.dig('commit', 'id') != head || publisher.dig('pipeline', 'id') != pipeline['id']))
    failures = jobs.select { |j| j['allow_failure'] == false && j['name'] != 'deploy:github' && j['status'] != 'success' }
    raise BootstrapError, 'Native pipeline failed outside the public mirror' unless failures.empty?
    if pipeline['status'] != 'success' && (!publisher || publisher['status'] == 'success')
      return {sourceRevision: head, build: {'version' => 1, 'mode' => 'source-primary', 'phase' => 'pending',
        'pipeline' => pipeline.slice('id', 'sha', 'status', 'web_url'), 'recipeHash' => @input.fetch('build').fetch('recipeHash')}, message: 'Native pipeline completion is not independently established.'}
    end
    mirror_failed = publisher && publisher['status'] == 'failed'
    artifacts = ['build:wizard', 'test:wizard'].zip(['build-evidence.json', 'wizard-evidence.json']).map do |name, filename|
      matches = jobs.select { |j| j['name'] == name }; job = matches.first
      raise BootstrapError, 'Native Wizard jobs must be successful and required' unless matches.length == 1 && job['status'] == 'success' && job['allow_failure'] == false && job.dig('commit', 'id') == head && job.dig('pipeline', 'id') == pipeline['id']
      artifact = get(prefix + "jobs/#{job.fetch('id')}/artifacts/#{filename}")
      raise BootstrapError, 'Native Wizard artifact identity changed' unless artifact['version'] == 1 && artifact['sourceCommit'] == head && artifact['pipelineId'] == pipeline['id']
      artifact
    end
    build, smoke = artifacts
    raise BootstrapError, 'Native Wizard checks are incomplete' unless build['testRunner'] == 'vitest' &&
      ['unitTests', 'lint', 'typecheck', 'productionBuild'].all? { |k| build[k] == true } &&
      ['http', 'renderedUI', 'projects', 'spa', 'configurationBackup', 'cubeSignature'].all? { |k| smoke[k] == true } && build['imageRef'] == smoke['imageRef'] &&
      build.fetch('imageRef').match?(%r{\A#{Regexp.escape(@input.fetch('registryPrefix'))}@sha256:[a-f0-9]{64}\z})
    {sourceRevision: head, build: {'version' => 1, 'mode' => 'source-primary', 'phase' => 'candidate-verified', 'recipeHash' => @input.fetch('build').fetch('recipeHash'),
      'pipeline' => {'id' => pipeline['id'], 'sha' => head, 'status' => pipeline['status'], 'webUrl' => pipeline['web_url']},
      'publishing' => {'mirrorFailed' => !!mirror_failed, 'status' => publisher ? publisher['status'] : 'absent'},
      'artifact' => {'imageRef' => build['imageRef'], 'sourceCommit' => head, 'pipelineId' => pipeline['id']}},
      message: mirror_failed ? 'Native checks passed; the public GitHub mirror failed. Production is independent of mirror availability.' : 'Native source-primary build and browser evidence verified. Production remains a separate operator promotion.'}
  end
end
