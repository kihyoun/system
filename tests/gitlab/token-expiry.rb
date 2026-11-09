require 'json'
require 'ostruct'
require_relative '../../project-bootstrap/token-expiry/status'

class Project
  def self.find_by_full_path(path)
    raise 'Unexpected project lookup' unless ['example/system', 'missing/project'].include?(path)
    path == 'example/system' ? OpenStruct.new(id: 42) : nil
  end
end
module Ci
  class Variable
    def self.find_by(project_id:, key:, environment_scope:)
      raise 'Unscoped query' unless project_id == 42 && environment_scope == '*' && BootstrapperTokenExpiry::PURPOSES.key?(key)
      OpenStruct.new(value: key.start_with?('RENOVATE', 'SYSTEM_RELEASE') ? 'private-token-value' : nil).tap do |variable|
        unless key.start_with?('RENOVATE', 'SYSTEM_RELEASE')
          def variable.value = raise('External secret must not be decrypted')
        end
      end
    end
  end
end
class PersonalAccessToken
  def self.find_by_token(value)
    raise 'Unexpected token lookup' unless value == 'private-token-value'
    OpenStruct.new(id: 7, expires_at: Date.new(2027, 1, 1), revoked: false)
  end
  def self.create!(*) = raise('Must not create credentials during status lookup')
end
result = BootstrapperTokenExpiry.status({'projects' => ['example/system', 'missing/project']})
raise 'Unexpected rows' unless result[:credentials].length == 8
raise 'GitLab expiry missing' unless result[:credentials].first[:expiresAt] == '2027-01-01'
raise 'External date guessed' unless result[:credentials][2][:expirySource] == 'unavailable'
raise 'Missing project claimed configured' if result[:credentials].last[:configured]
raise 'Secret in output' if JSON.generate(result).include?('private-token-value')
begin
  BootstrapperTokenExpiry.status({'projects' => ['example/../foreign']})
  raise 'Unsafe path accepted'
rescue ArgumentError
end
puts 'PASS selected-project read-only token metadata with no external decryption or secret output.'
