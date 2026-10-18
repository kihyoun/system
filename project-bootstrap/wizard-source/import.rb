# Uses the short-lived server-side API credential owned/revoked by provision.rb.
require 'digest'
class WizardSourceImport
  def initialize(api, input, project)
    @api, @input, @project = api, input, project
  end

  def call
    marker = 'System Bootstrapper operation ' + @input.fetch('operation')
    expected = @input.fetch('repository')
    raise BootstrapError, 'Wizard repository ownership changed' unless @project &&
      @project['id'] == expected.fetch('id') && @project['description'] == marker &&
      @project['visibility'] == 'private' && @project['path_with_namespace'] == expected.fetch('path') &&
      @project['default_branch'] == expected.fetch('defaultBranch') &&
      @project['ci_config_path'] == '.system-bootstrapper/ci.yml'
    branch = @project.fetch('default_branch')
    prefix = "projects/#{@project.fetch('id')}/repository/"
    get_file = lambda do |filename|
      code, file = @api.call(Net::HTTP::Get, prefix + 'files/' + URI.encode_www_form_component(filename) + '?ref=' + URI.encode_www_form_component(branch))
      raise BootstrapError, 'Wizard source lookup failed; retry initialization' unless [200, 404].include?(code)
      code == 200 ? file : nil
    end
    ci = get_file.call('.system-bootstrapper/ci.yml')
    raise BootstrapError, 'Managed CI changed; refusing source initialization' unless ci && Base64.decode64(ci.fetch('content')) == @input.fetch('expectedCi')
    snapshot = @input.fetch('snapshot')
    manifest_path = '.system-bootstrapper/wizard-source.json'
    manifest_content = JSON.generate({version: 1, operation: @input.fetch('operation'),
      sourceRevision: snapshot.fetch('sourceRevision'), manifestHash: snapshot.fetch('manifestHash')})
    installed = get_file.call(manifest_path)
    if installed
      raise BootstrapError, 'Wizard source marker changed; refusing overwrite' unless Base64.decode64(installed.fetch('content')) == manifest_content
      snapshot.fetch('files').each do |source|
        file = get_file.call(source.fetch('path'))
        raise BootstrapError, 'Imported Wizard source changed; refusing overwrite' unless file &&
          Digest::SHA256.hexdigest(Base64.decode64(file.fetch('content'))) == source.fetch('sha256') &&
          !!file['execute_filemode'] == (source.fetch('mode') == '100755') &&
          file.fetch('last_commit_id') == installed.fetch('last_commit_id')
      end
      return {importCommit: installed.fetch('last_commit_id'), phase: 'source-imported'}
    end
    actions = []
    snapshot.fetch('files').each do |source|
      raise BootstrapError, 'Wizard source path is occupied; refusing overwrite: ' + source.fetch('path') if get_file.call(source.fetch('path'))
      actions << {action: 'create', file_path: source.fetch('path'), encoding: 'base64', content: source.fetch('content')}
      # GitLab considers execute_filemode only for chmod commit actions.
      actions << {action: 'chmod', file_path: source.fetch('path'), execute_filemode: true} if source.fetch('mode') == '100755'
    end
    actions << {action: 'create', file_path: manifest_path, content: manifest_content}
    # Revalidate the CI file at write time. A no-op guarded update keeps its bytes
    # unchanged, while GitLab rejects a concurrent edit to the scaffold.
    actions << {action: 'update', file_path: '.system-bootstrapper/ci.yml', content: @input.fetch('expectedCi'), last_commit_id: ci.fetch('last_commit_id')}
    code, commit = @api.call(Net::HTTP::Post, prefix + 'commits', {
      branch: branch, commit_message: 'Initialize pinned Wizard source [skip ci]', actions: actions})
    raise BootstrapError, 'Wizard source import conflicted or failed; retry to inspect the same repository' unless code == 201
    {importCommit: commit.fetch('id'), phase: 'source-imported'}
  end
end
