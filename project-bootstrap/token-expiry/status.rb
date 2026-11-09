# Read-only metadata adapter. Secret CI values never leave this Rails process.
require 'date'

module BootstrapperTokenExpiry
  PURPOSES = {
    'RENOVATE_TOKEN' => ['Renovate', 'GitLab'],
    'SYSTEM_RELEASE_GITLAB_TOKEN' => ['Release metadata access', 'GitLab'],
    'GITHUB_RELEASE_TOKEN' => ['GitHub release publication', 'GitHub'],
    'DOCKERHUB_TOKEN' => ['Container publication', 'Docker Hub']
  }.freeze

  def self.status(input)
    paths = input.fetch('projects')
    raise ArgumentError, 'Invalid credential project selection' unless paths.is_a?(Array) && paths.length <= 8 &&
      paths.all? { |item| item.is_a?(String) && item.length <= 255 && item.match?(%r{\A[a-zA-Z0-9_.-]+(?:/[a-zA-Z0-9_.-]+)+\z}) &&
        item.split('/').none? { |part| ['.', '..'].include?(part) } }
    rows = paths.uniq.flat_map do |full_path|
      project = Project.find_by_full_path(full_path)
      PURPOSES.map do |key, (purpose, provider)|
        result = {projectPath: full_path, key: key, purpose: purpose, provider: provider,
                  expiresAt: nil, revoked: nil, expirySource: 'unavailable', configured: false}
        next result unless project
        variable = Ci::Variable.find_by(project_id: project.id, key: key, environment_scope: '*')
        next result unless variable
        result[:configured] = true
        # External providers do not expose expiry through this GitLab variable.
        # Do not decrypt those values just to display a name or guessed date.
        next result unless provider == 'GitLab'
        token = PersonalAccessToken.find_by_token(variable.value)
        next result unless token
        result.merge(expiresAt: token.expires_at&.iso8601, revoked: !!token.revoked,
                     expirySource: 'gitlab', tokenId: token.id)
      rescue StandardError
        # DB/permission/decryption errors can contain secret material.
        result.merge(error: 'metadata-unavailable')
      end
    end
    {credentials: rows}
  end
end
