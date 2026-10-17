require 'json'
require 'base64'
require 'digest'
require 'net/http'
require 'uri'
class BootstrapError < StandardError; end
require_relative '../../project-bootstrap/wizard-source/import'
def assert(condition, message = 'Assertion failed')
  raise message unless condition
end
def rejects(message)
  begin
    yield
    raise 'Expected rejection'
  rescue BootstrapError => error
    assert(error.message.include?(message), error.message)
  end
end
class RepositoryFixture
  attr_reader :files, :commits
  attr_accessor :after_commit_failure, :before_commit_edit
  def initialize
    @files = {'.system-bootstrapper/ci.yml' => row('disabled CI', 'scaffold'), 'README.md' => row('Keep scaffold README', 'initial')}
    @commits = 0
  end
  def row(content, commit, executable = false)
    {'content' => Base64.strict_encode64(content), 'last_commit_id' => commit, 'execute_filemode' => executable}
  end
  def call(method, route, body = nil)
    if method == Net::HTTP::Get
      name = URI.decode_www_form_component(route.split('/files/')[1].split('?')[0])
      return @files.key?(name) ? [200, @files[name].dup] : [404, {}]
    end
    assert(method == Net::HTTP::Post && route.end_with?('/commits'))
    assert(body.fetch(:commit_message).include?('[skip ci]'))
    @files['.system-bootstrapper/ci.yml'] = row('edited concurrently', 'concurrent') if @before_commit_edit
    candidate = Marshal.load(Marshal.dump(@files))
    body.fetch(:actions).each do |action|
      name = action.fetch(:file_path)
      case action.fetch(:action)
      when 'create'
        return [400, {}] if candidate.key?(name)
        content = action[:encoding] == 'base64' ? Base64.strict_decode64(action.fetch(:content)) : action.fetch(:content)
        candidate[name] = row(content, 'imported')
      when 'chmod'
        candidate.fetch(name)['execute_filemode'] = action.fetch(:execute_filemode)
      when 'update'
        return [400, {}] unless candidate.fetch(name)['last_commit_id'] == action.fetch(:last_commit_id)
        candidate[name] = row(action.fetch(:content), 'imported')
      else
        raise 'Unexpected action'
      end
    end
    @files.replace(candidate); @commits += 1
    raise BootstrapError, 'Interrupted after commit' if @after_commit_failure
    [201, {'id' => 'imported'}]
  end
end
source = [['source.ts', 'source', '100644'], ['binary.png', "\x00\xff".b, '100644'], ['run.sh', '#!/bin/sh', '100755'], ['.gitlab-ci.yml', 'upstream untouched', '100644']].map do |name, content, mode|
  {'path' => name, 'content' => Base64.strict_encode64(content), 'sha256' => Digest::SHA256.hexdigest(content), 'mode' => mode}
end
project = {'id' => 1, 'description' => 'System Bootstrapper operation registration', 'visibility' => 'private',
  'path_with_namespace' => 'root/wizard', 'default_branch' => 'main', 'ci_config_path' => '.system-bootstrapper/ci.yml'}
input = {'operation' => 'registration', 'repository' => {'id' => 1, 'path' => 'root/wizard', 'defaultBranch' => 'main'},
  'expectedCi' => 'disabled CI', 'snapshot' => {'sourceRevision' => 'a' * 40, 'manifestHash' => 'b' * 64, 'files' => source}}
fixture = RepositoryFixture.new
run = -> { WizardSourceImport.new(fixture.method(:call), input, project).call }
assert(run.call[:importCommit] == 'imported'); assert(fixture.commits == 1)
assert(Base64.decode64(fixture.files.fetch('README.md').fetch('content')) == 'Keep scaffold README')
assert(Base64.decode64(fixture.files.fetch('binary.png').fetch('content')) == "\x00\xff".b)
assert(fixture.files.fetch('run.sh').fetch('execute_filemode'))
assert(Base64.decode64(fixture.files.fetch('.system-bootstrapper/ci.yml').fetch('content')) == 'disabled CI')
assert(run.call[:importCommit] == 'imported'); assert(fixture.commits == 1, 'Retry duplicated import')
fixture.files['source.ts'] = fixture.row('edited', 'maintainer')
rejects('source changed') { run.call }; assert(fixture.commits == 1)
fixture = RepositoryFixture.new; fixture.after_commit_failure = true
rejects('Interrupted after commit') { run.call }; fixture.after_commit_failure = false
assert(run.call[:importCommit] == 'imported'); assert(fixture.commits == 1, 'Interrupted retry duplicated commit')
fixture = RepositoryFixture.new; fixture.files['source.ts'] = fixture.row('occupied', 'maintainer')
rejects('occupied') { run.call }; assert(fixture.commits == 0)
fixture = RepositoryFixture.new; fixture.files['.system-bootstrapper/ci.yml'] = fixture.row('changed', 'maintainer')
rejects('Managed CI changed') { run.call }; assert(fixture.commits == 0)
fixture = RepositoryFixture.new; fixture.before_commit_edit = true
rejects('conflicted or failed') { run.call }; assert(fixture.commits == 0); assert(!fixture.files.key?('source.ts'))
%w[id description visibility path_with_namespace default_branch ci_config_path].each do |key|
  altered = project.merge(key => 'foreign')
  rejects('ownership changed') { WizardSourceImport.new(fixture.method(:call), input, altered).call }
end
puts 'Wizard import adapter: atomic create-only import, binary/modes, README/disabled CI preservation, ownership, content conflicts, concurrent CI edit and interrupted retry passed.'
