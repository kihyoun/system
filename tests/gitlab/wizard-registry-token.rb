require 'json'
require 'base64'
require 'date'
require 'stringio'
def assert(value, message = 'assertion failed')
  raise message unless value
end
class Date
  def self.tomorrow = today + 1
end
class RecoveryCredential
  attr_reader :id, :name, :username, :token
  attr_accessor :revoked, :scopes
  def initialize(id, name, scopes)
    @id, @name, @scopes = id, name, scopes
    @username, @token, @revoked = "gitlab+deploy-token-#{id}", 'synthetic-secret', false
  end
  def persisted? = true
  def revoke! = @revoked = true
end
class RecoveryTokens
  attr_reader :items
  def initialize = @items = []
  def where(name:, revoked:)
    selected = @items.select { |item| item.name == name && item.revoked == revoked }
    selected.define_singleton_method(:find_each) { |&block| each(&block) }
    selected
  end
  def find(id) = @items.find { |item| item.id == id } || (raise 'missing credential')
end
class Project
  attr_reader :deploy_tokens
  def initialize = @deploy_tokens = RecoveryTokens.new
  def full_path = 'root/wizard'
  def self.find(id)
    raise 'wrong project id' unless id == 12
    @instance ||= new
  end
end
class User
  def self.find_by_username(name)
    raise 'wrong administrator' unless name == 'root'
    new
  end
  def admin? = true
  def active? = true
end
module Projects
  module DeployTokens
    class CreateService
      class << self
        attr_accessor :unexpected_scope
      end
      def initialize(project, admin, options)
        assert(admin.admin?)
        assert(options.keys.sort == %i[expires_at name read_registry])
        assert(options[:read_registry] == true)
        assert(options[:expires_at] == Date.today + 1)
        @project, @options = project, options
      end
      def execute
        credential = RecoveryCredential.new(21, @options[:name], self.class.unexpected_scope ? ['api'] : ['read_registry'])
        @project.deploy_tokens.items << credential
        {status: :success, deploy_token: credential}
      end
    end
  end
end
def invoke(action, extra = {})
  Object.send(:remove_const, :WIZARD_RECOVERY_INPUT) if Object.const_defined?(:WIZARD_RECOVERY_INPUT)
  Object.const_set(:WIZARD_RECOVERY_INPUT, Base64.strict_encode64(JSON.generate({projectId: 12, projectPath: 'root/wizard', action: action}.merge(extra))))
  previous = $stdout
  $stdout = StringIO.new
  begin
    load File.expand_path('../../system/wizard-registry-token.rb', __dir__)
    JSON.parse($stdout.string)
  ensure
    $stdout = previous
  end
end
tokens = Project.find(12).deploy_tokens.items
unrelated = RecoveryCredential.new(1, 'maintainer-access', ['api'])
stale = RecoveryCredential.new(2, 'system-bootstrapper-wizard-image-recovery', ['read_registry'])
tokens.push(unrelated, stale)
created = invoke('create')
assert(created['id'] == 21 && created['token'] == 'synthetic-secret')
assert(stale.revoked && !unrelated.revoked && !tokens.last.revoked)
assert(invoke('revoke', tokenId: 21)['revoked'] && tokens.last.revoked)
begin
  invoke('revoke', tokenId: 1)
  raise 'unrelated token was accepted'
rescue RuntimeError => error
  assert(error.message.include?('Unowned recovery credential'))
end
assert(!unrelated.revoked)
Projects::DeployTokens::CreateService.unexpected_scope = true
begin
  invoke('create')
  raise 'unexpected privilege was accepted'
rescue RuntimeError => error
  assert(error.message.include?('Unexpected credential privilege'))
end
assert(tokens.last.revoked)
assert(invoke('cleanup')['revoked'] && !unrelated.revoked)
puts 'Wizard registry credentials: exact project, read-only registry scope, next-day safety expiry and owned-only revocation passed.'
