# Native CI selection fixtures use Ruby's regexp engine and the actual YAML.
require 'yaml'
require 'digest'
require 'tmpdir'
require 'fileutils'
require 'open3'
root = File.expand_path('../..', __dir__)
text = File.binread(File.join(root, '.gitlab-ci.yml'))
raise 'Cube signature changed' unless text[807] == '$' && Digest::MD5.hexdigest(text[0, 1184]) == 'bd4a8426355824593a5e21ad759830c1'
config = YAML.safe_load(text, aliases: true)
jobs = config.select { |name, value| !name.start_with?('.') && value.is_a?(Hash) && value.key?('script') }
full = %w[prepare:wizard-source test:isolated test:candidate-image test:platform-candidate build]
baseline = {'CI_PIPELINE_SOURCE' => 'merge_request_event', 'CI_DEFAULT_BRANCH' => 'master',
            'GITHUB_BACKUP_ENABLED' => 'true', 'DOCKERHUB_PUBLISH_ENABLED' => 'true', 'CI_COMMIT_REF_PROTECTED' => 'false'}
condition = lambda do |expression, environment|
  expression.split('&&').all? do |term|
    match = /\A\s*\$([A-Z_]+) == (?:\$([A-Z_]+)|"([^"]*)"|(null))\s*\z/.match(term)
    raise 'Unknown condition syntax' unless match
    left = environment[match[1]]
    right = match[2] ? environment[match[2]] : match[4] ? nil : match[3]
    left == right
  end
end
select = lambda do |paths, environment = baseline, changes_available = true|
  jobs.filter_map do |name, job|
    rule = job.fetch('rules').find do |item|
      next false if item['if'] && !condition.call(item['if'], environment)
      next true unless item['changes']
      # GitLab chooses the full lane when a comparison is unavailable; its
      # documented 50,000-path limit also assumes a match rather than skipping.
      next true if !changes_available || paths.length > 50_000
      pattern = item.fetch('changes').fetch('regexp')
      raise 'Rule exceeds native length limit' unless pattern.length <= 255
      regexp = Regexp.new(pattern)
      paths.any? { |file| regexp.match?(file) }
    end
    name if rule && rule.fetch('when', 'on_success') != 'never'
  end.sort
end
assert_jobs = lambda do |name, paths, expected, environment = baseline, changes_available = true|
  actual = select.call(paths, environment, changes_available)
  raise "#{name}: expected #{expected.sort}, got #{actual}" unless actual == expected.sort
end
light = ['check:documentation']
runtime = light + full
assert_jobs.call('AGENTS only', ['AGENTS.md'], light)
assert_jobs.call('root guides', ['README.md', 'Prepare-Host.md'], light)
assert_jobs.call('guide and screenshots', ['docs/HANDBOOK.md', 'docs/images/new.png'], light)
assert_jobs.call('mixed documentation and code', ['README.md', 'system/start.sh'], runtime)
assert_jobs.call('unknown location', ['future-component/new-format.xyz'], runtime)
assert_jobs.call('CI configuration', ['.gitlab-ci.yml'], runtime)
assert_jobs.call('CI helper', ['gitlab/check-documentation.js'], runtime)
assert_jobs.call('test change', ['tests/README.md'], runtime)
assert_jobs.call('build/infrastructure', ['bootstrapper/Dockerfile', 'system/docker-compose.yml'], runtime)
assert_jobs.call('submodule configuration', ['.gitmodules'], runtime)
assert_jobs.call('gitlink', ['wizard'], runtime)
assert_jobs.call('code inside docs', ['docs/execute.sh'], runtime)
assert_jobs.call('newline filename', ["README.md\nsystem/start.sh"], runtime)
assert_jobs.call('newline inside docs', ["docs/guide\nexecute.md"], runtime)
assert_jobs.call('case mismatch', ['readme.md'], runtime)
assert_jobs.call('suffixed guide', ['README.md.js'], runtime)
assert_jobs.call('empty MR', [], light)
assert_jobs.call('large comparison', Array.new(50_001, 'README.md'), runtime)
push = baseline.merge('CI_PIPELINE_SOURCE' => 'push', 'CI_COMMIT_BRANCH' => 'master', 'CI_COMMIT_REF_PROTECTED' => 'true')
assert_jobs.call('protected docs push mirrors but does not publish images', ['AGENTS.md'], light + ['deploy:github'], push)
assert_jobs.call('protected runtime push', ['system/start.sh'], runtime + %w[deploy:github deploy:dockerhub], push)
assert_jobs.call('disabled publishing roles', ['system/start.sh'], runtime,
                 push.merge('GITHUB_BACKUP_ENABLED' => 'false', 'DOCKERHUB_PUBLISH_ENABLED' => 'false'))
assert_jobs.call('unprotected default push', ['system/start.sh'], runtime, push.merge('CI_COMMIT_REF_PROTECTED' => 'false'))
assert_jobs.call('first push is conservative', ['README.md'], runtime + %w[deploy:github deploy:dockerhub], push, false)
assert_jobs.call('other branch push', ['system/start.sh'], [], push.merge('CI_COMMIT_BRANCH' => 'feature'))
assert_jobs.call('tag push', ['system/start.sh'], [], push.merge('CI_COMMIT_BRANCH' => nil, 'CI_COMMIT_TAG' => 'v1'))
assert_jobs.call('manual/scheduled default runs remain full', ['README.md'], runtime, push.merge('CI_PIPELINE_SOURCE' => 'web'), false)
assert_jobs.call('scheduled default run remains full', ['README.md'], runtime, push.merge('CI_PIPELINE_SOURCE' => 'schedule'), false)
Dir.mktmpdir('ci-renames-') do |directory|
  git = lambda do |*arguments|
    output, error, status = Open3.capture3('git', '-C', directory, *arguments)
    raise error unless status.success?
    output.strip
  end
  git.call('init', '-b', 'master'); git.call('config', 'user.name', 'Fixture'); git.call('config', 'user.email', 'fixture@example.invalid')
  File.write(File.join(directory, 'runtime.sh'), "echo ready\n")
  File.write(File.join(directory, 'README.md'), "# Guide\n")
  git.call('add', '.'); git.call('commit', '-qm', 'Initial'); base = git.call('rev-parse', 'HEAD')
  FileUtils.mkdir_p(File.join(directory, 'docs')); git.call('mv', 'runtime.sh', 'docs/moved.md')
  git.call('commit', '-qm', 'Rename runtime into docs')
  paths = git.call('diff', '--no-renames', '--name-only', '-z', base, 'HEAD').split("\0")
  assert_jobs.call('real code-to-doc rename retains runtime coverage', paths, runtime)
  base = git.call('rev-parse', 'HEAD'); git.call('mv', 'docs/moved.md', 'new-runtime.sh')
  git.call('commit', '-qm', 'Rename docs into runtime')
  paths = git.call('diff', '--no-renames', '--name-only', '-z', base, 'HEAD').split("\0")
  assert_jobs.call('real doc-to-code rename retains runtime coverage', paths, runtime)
  base = git.call('rev-parse', 'HEAD'); git.call('rm', 'new-runtime.sh'); git.call('commit', '-qm', 'Delete runtime')
  assert_jobs.call('runtime deletion', git.call('diff', '--no-renames', '--name-only', '-z', base, 'HEAD').split("\0"), runtime)
  base = git.call('rev-parse', 'HEAD'); git.call('rm', 'README.md'); git.call('commit', '-qm', 'Delete docs')
  assert_jobs.call('documentation deletion', git.call('diff', '--name-only', '-z', base, 'HEAD').split("\0"), light)
end
full.each do |name|
  job = jobs.fetch(name)
  raise 'Full checks made optional' if job['allow_failure'] == true || job.fetch('rules').any? { |rule| rule['when'] == 'manual' }
  Array(job['dependencies']).each { |dependency| raise 'Inconsistent artifact selection' unless full.include?(dependency) }
end
documentation = jobs.fetch('check:documentation')
raise 'Documentation lane must reuse the native trusted Docker pool without DinD' unless documentation['services'] == [] && documentation['tags'] == ['docker']
raise 'Documentation checker must run through its isolated child launcher' unless documentation['script'] == ['sh tests/ci-documentation.sh'] &&
  documentation['after_script'] == ['sh tests/ci-documentation.sh cleanup']
raise 'Documentation lane must retain its short bounded budget' unless documentation['timeout'] == '3m' &&
  documentation.dig('variables', 'RUNNER_SCRIPT_TIMEOUT') == '2m' && documentation.dig('variables', 'RUNNER_AFTER_SCRIPT_TIMEOUT') == '30s'
raise 'Documentation lane must not require runtime artifacts' if documentation['needs'] || documentation['dependencies']
raise 'Documentation lane must be required' unless documentation['allow_failure'] == false
raise 'Unexpected mirror dependencies' unless jobs.fetch('deploy:github')['dependencies'] == []
raise 'Mirror context was weakened' unless jobs.fetch('deploy:github')['script'] == ['sh gitlab/github-backup-ci.sh'] &&
  jobs.fetch('deploy:github').fetch('rules').first.fetch('if') == '$GITHUB_BACKUP_ENABLED == "true" && $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_COMMIT_REF_PROTECTED == "true" && $CI_COMMIT_TAG == null'
puts 'PASS: native YAML docs/runtime/mixed/unknown/CI/event selection, real renames/deletions, large/newline paths, artifact closure and protected publishing roles'
