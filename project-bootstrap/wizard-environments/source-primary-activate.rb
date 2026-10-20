require 'digest'
class WizardSourcePrimaryEnvironments
  VARIABLES = ['SYSTEM_WIZARD_ENVIRONMENT_IMAGE', 'SYSTEM_WIZARD_ENVIRONMENT_OPERATION', 'WIZARD_REVIEW_HOST', 'WIZARD_BETA_HOST'].freeze
  def initialize(api, input, project)
    @api, @input, @project = api, input, project
    @environment = input.fetch('environments')
  end
  def call
    owned!
    key = Digest::SHA256.hexdigest("system-wizard-environments:#{@project.fetch('id')}")[0, 15].to_i(16)
    ActiveRecord::Base.connection_pool.with_connection do |connection|
      raise BootstrapError, 'Wizard environment operation is busy; retry shortly' unless connection.select_value("SELECT pg_try_advisory_lock(#{key})")
      begin
        synchronize
      ensure
        connection.select_value("SELECT pg_advisory_unlock(#{key})")
      end
    end
  end
  private
  def prefix
    "projects/#{@project.fetch('id')}/"
  end
  def read(route, missing = false)
    code, result = @api.call(Net::HTTP::Get, route)
    return nil if missing && code == 404
    raise BootstrapError, 'Source-primary environment lookup failed; refresh the same operation' unless code == 200
    result
  end
  def owned!
    repository, binding = @input.fetch('repository'), @input.fetch('sourcePrimary')
    raise BootstrapError, 'Source-primary Wizard repository ownership changed' unless repository['managementMode'] == 'source-primary' &&
      @project['id'] == repository.fetch('id') && @project['path_with_namespace'] == repository.fetch('path') &&
      @project['default_branch'] == repository.fetch('defaultBranch') && @project.dig('namespace', 'id') == repository.fetch('namespaceId') &&
      @project['ci_config_path'] == '.gitlab/primary.yml' && @project['visibility'] == 'private' &&
      @project['only_allow_merge_if_pipeline_succeeds'] == true && @project['only_allow_merge_if_all_discussions_are_resolved'] == true &&
      binding['version'] == 1 && @environment['managementMode'] == 'source-primary' && @environment['version'] == 1 &&
      @environment['activationCommit'] == binding.fetch('adoptionCommit') && @environment['ciFiles'] == binding.fetch('ciFiles') &&
      @environment.fetch('operation').match?(/\A[a-f0-9]{48}\z/) && @environment.fetch('helperImage').match?(/\Asha256:[a-f0-9]{64}\z/) &&
      @environment['controller'] == 'system_bootstrapper_1' && @input['controller'] == 'system_bootstrapper_1'
    branch = read(prefix + 'repository/branches/' + URI.encode_www_form_component(@project.fetch('default_branch')))
    sha = branch.fetch('commit').fetch('id')
    files = binding.fetch('ciFiles')
    raise BootstrapError, 'Source-primary CI manifest is incomplete' unless files.is_a?(Array) && !files.empty? && files.length <= 40 &&
      files.map { |row| row['path'] }.uniq.length == files.length &&
      ['.gitlab/primary.yml', '.gitlab/delivery/environment.sh'].all? { |name| files.any? { |row| row['path'] == name } }
    files.each do |row|
      name = row.fetch('path')
      raise BootstrapError, 'Source-primary CI manifest is invalid' unless row.keys.sort == ['path', 'sha256'] &&
        name.match?(%r{\A(?:\.gitlab/|\.system-bootstrapper/build-v1/)[A-Za-z0-9_./-]+\z}) && !name.split('/').include?('..') &&
        row.fetch('sha256').match?(/\A[a-f0-9]{64}\z/)
      file = read(prefix + 'repository/files/' + URI.encode_www_form_component(name) + '?ref=' + sha)
      raise BootstrapError, 'Source-primary CI changed; a reviewed adoption is required' unless
        Digest::SHA256.hexdigest(Base64.strict_decode64(file.fetch('content').delete("\n"))) == row.fetch('sha256')
    end
    previous = @input['previousEnvironments']
    if previous
      raise BootstrapError, 'Stop active and reconcile pending environments before settings updates' if
        previous.fetch('deployments', {}).values.any? { |slot| slot['active'] || slot['pending'] || !slot.fetch('retired', []).empty? }
      raise BootstrapError, 'Source-primary previous reservation changed' unless previous['managementMode'] == 'source-primary' &&
        previous['ciFiles'] == @environment['ciFiles'] && previous['activationCommit'] == @environment['activationCommit']
    end
  end
  def values(environment)
    {'SYSTEM_WIZARD_ENVIRONMENT_IMAGE' => environment.fetch('helperImage'),
      'SYSTEM_WIZARD_ENVIRONMENT_OPERATION' => environment.fetch('operation'),
      'WIZARD_REVIEW_HOST' => environment.fetch('settings').fetch('review').fetch('enabled') ? environment['settings']['review'].fetch('host') : '',
      'WIZARD_BETA_HOST' => environment.fetch('settings').fetch('beta').fetch('enabled') ? environment['settings']['beta'].fetch('host') : ''}
  end
  def variable(name)
    value = read(prefix + 'variables/' + name + '?filter%5Benvironment_scope%5D=*', true)
    return nil unless value
    raise BootstrapError, 'Source-primary environment variable ownership changed' unless value['key'] == name &&
      value['environment_scope'] == '*' && value['variable_type'] == 'env_var' && value['protected'] == false &&
      value['masked'] == false && value['raw'] == true && value['hidden'] != true
    value.fetch('value')
  end
  def synchronize
    expected = values(@input['previousEnvironments'] || @environment)
    target = values(@environment)
    current = VARIABLES.to_h { |name| [name, variable(name)] }
    unless VARIABLES.all? { |name| [expected.fetch(name), target.fetch(name)].include?(current.fetch(name)) }
      return {environments: @environment.merge('phase' => 'requires-reconciliation'),
        message: 'An environment variable has an unexpected value. Inspect the recorded reservation; nothing was overwritten.'}
    end
    if current != target && @input['action'] == 'wizard-environments-primary-status'
      return {environments: @environment.merge('phase' => 'pending'),
        message: 'The recorded variable update is partially applied. Confirm the same settings to reconcile the exact operation.'}
    end
    if current != target
      VARIABLES.each do |name|
        actual = variable(name)
        next if actual == target.fetch(name)
        raise BootstrapError, 'Environment variable raced configuration; inspect the same operation' unless actual == expected.fetch(name)
        begin
          code, = @api.call(Net::HTTP::Put, prefix + 'variables/' + name + '?filter%5Benvironment_scope%5D=*',
            {value: target.fetch(name), variable_type: 'env_var', protected: false, masked: false, raw: true, environment_scope: '*'})
          raise BootstrapError, 'Variable update requires read-only reconciliation' unless code == 200
        rescue StandardError
          return {environments: @environment.merge('phase' => 'pending'),
            message: 'A variable update may have completed. Refresh the same reservation before retrying.'}
        end
      end
    end
    raise BootstrapError, 'Environment variables changed after synchronization; refresh the same operation' unless
      VARIABLES.all? { |name| variable(name) == target.fetch(name) }
    {environments: @environment.merge('phase' => 'ready'),
      message: 'Source-primary environment settings verified. Source code, pipelines and Production are unchanged.'}
  end
end
