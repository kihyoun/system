# Read-only operational samples; no credentials or record contents leave Rails.
require 'json'
require 'digest'
projects = Project.order(:id).limit(10).map do |project|
  [project.id, project.full_path, project.repository.empty? ? nil : project.repository.commit&.id]
end
samples = {
  projects: projects,
  users: User.order(:id).limit(10).pluck(:id, :username),
  issues: Issue.order(:id).limit(10).pluck(:id, :project_id, :iid),
  mergeRequests: MergeRequest.order(:id).limit(10).pluck(:id, :target_project_id, :iid),
  registries: ContainerRepository.order(:id).limit(10).pluck(:id, :project_id, :name)
}
puts JSON.generate(format: 'system-upgrade-data-sample-v1',
                   sha256: Digest::SHA256.hexdigest(JSON.generate(samples)),
                   sampledProjects: projects.length,
                   scope: 'up-to-ten-existing-records-per-kind-and-project-repository-heads')
