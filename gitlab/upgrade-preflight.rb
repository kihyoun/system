# Read-only preflight; values are counts/version, never credentials or user data.
require 'json'
connections = Gitlab::Database.database_base_models
unfinished = connections.sum do |_name, model|
  model.connection.select_value('SELECT COUNT(*) FROM batched_background_migrations WHERE status NOT IN (3, 6)').to_i
end
puts JSON.generate(version: Gitlab::VERSION, edition: Gitlab.ee? ? 'EE' : 'CE',
                   unfinishedBackgroundMigrations: unfinished, # Preparing prerequisites and canceling runner jobs must also drain.
                   # Pending/created jobs have not been claimed and remain queued.
                   runningJobs: Ci::Build.where(status: %w[preparing running canceling]).count)
