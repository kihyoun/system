# Frozen-string-literal: true
# Read-only Rails adapter fixture: no database, Docker socket or live credentials.
require 'json'
require 'stringio'
module Gitlab
  VERSION = JSON.parse(File.read(File.expand_path('../../gitlab/security-release.json', __dir__))).fetch('fromVersion')
  def self.ee? = false
  class Database
    def self.database_base_models = { 'main' => FixtureDatabase, 'ci' => FixtureCiDatabase }
  end
end
class FixtureDatabase
  def self.connection = self
  def self.select_value(sql)
    raise 'unexpected background migration query' unless sql.include?('status NOT IN (3, 6)')
    @unfinished || 0
  end
  def self.unfinished=(value)
    @unfinished = value
  end
end
class FixtureCiDatabase < FixtureDatabase; end
module Ci
  class Build
    class << self
      attr_accessor :fixture_statuses
      def running = raise('the narrow running scope misses accepted active states')
      def where(status:)
        raise 'unexpected unsafe job selection' unless status.sort == %w[canceling preparing running]
        fixture_statuses.count { |value| status.include?(value) }.then { |count| Struct.new(:count).new(count) }
      end
    end
  end
end
adapter = File.expand_path('../../gitlab/upgrade-preflight.rb', __dir__)
[[%w[running], 1], [%w[preparing], 1], [%w[canceling], 1],
 [%w[pending created success failed canceled skipped manual scheduled], 0],
 [%w[preparing pending running canceling], 3]].each do |statuses, expected|
  Ci::Build.fixture_statuses = statuses
  previous, $stdout = $stdout, StringIO.new
  begin
    load adapter
    result = JSON.parse($stdout.string)
    raise 'active job missed' unless result['runningJobs'] == expected
    raise 'version/edition identity changed' unless result['version'] == Gitlab::VERSION && result['edition'] == 'CE'
  ensure
    $stdout = previous
  end
end
# An unfinished migration in the separate CI database must not disappear behind
# a clean main database; failed/paused work is counted by the same query.
FixtureCiDatabase.unfinished = 2
previous, $stdout = $stdout, StringIO.new
begin
  load adapter
  raise 'CI migrations missed' unless JSON.parse($stdout.string)['unfinishedBackgroundMigrations'] == 2
ensure
  $stdout = previous
end
puts 'PASS: preparing, running and canceling jobs block maintenance; unclaimed/terminal states remain untouched.'
