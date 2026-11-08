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
jobs.transform_values! { |job| job['extends'] ? config.fetch(job['extends']).merge(job) : job }
full = %w[prepare:wizard-source test:isolated test:candidate-image test:wizard-browser test:platform-candidate build]
baseline = {'CI_PIPELINE_SOURCE' => 'merge_request_event', 'CI_DEFAULT_BRANCH' => 'master',
            'GITHUB_BACKUP_ENABLED' => 'true', 'CI_COMMIT_REF_PROTECTED' => 'false'}
condition = lambda do |expression, environment|
  expression.split('&&').all? do |term|
    regexp_match = /\A\s*\$([A-Z_]+) =~ \/(.*)\/\s*\z/.match(term)
    next Regexp.new(regexp_match[2]).match?(environment[regexp_match[1]].to_s) if regexp_match
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
assert_jobs.call('protected runtime push', ['system/start.sh'], runtime + ['deploy:github'], push)
assert_jobs.call('disabled GitHub mirror', ['system/start.sh'], runtime,
                 push.merge('GITHUB_BACKUP_ENABLED' => 'false'))
hub = push.merge('DOCKERHUB_PUBLISH_ENABLED' => 'true')
assert_jobs.call('enabled protected runtime push publishes accepted images', ['system/start.sh'], runtime + ['deploy:github', 'deploy:dockerhub'], hub)
assert_jobs.call('documentation push does not publish public images', ['README.md'], light + ['deploy:github'], hub)
assert_jobs.call('MR cannot publish even with an enable selector', ['system/start.sh'], runtime,
                 baseline.merge('DOCKERHUB_PUBLISH_ENABLED' => 'true', 'CI_COMMIT_REF_PROTECTED' => 'true'))
review = baseline.merge('SYSTEM_REVIEW_ENABLED' => 'true', 'CI_PROJECT_ID' => '42', 'CI_MERGE_REQUEST_SOURCE_PROJECT_ID' => '42')
review_jobs = %w[deploy:wizard-review stop:wizard-review]
assert_jobs.call('same-project MR offers one optional shared Wizard Review', ['wizard'], runtime + review_jobs, review)
assert_jobs.call('documentation-only MR needs no candidate artifacts', ['README.md'], light, review)
assert_jobs.call('fork MR cannot deploy the shared Review', ['wizard'], runtime, review.merge('CI_MERGE_REQUEST_SOURCE_PROJECT_ID' => '43'))
assert_jobs.call('Review opt-in never deploys a push', ['wizard'], runtime + ['deploy:github'], push.merge('SYSTEM_REVIEW_ENABLED' => 'true'))
assert_jobs.call('unprotected default push', ['system/start.sh'], runtime, push.merge('CI_COMMIT_REF_PROTECTED' => 'false'))
assert_jobs.call('first push is conservative', ['README.md'], runtime + ['deploy:github'], push, false)
assert_jobs.call('other branch push', ['system/start.sh'], [], push.merge('CI_COMMIT_BRANCH' => 'feature'))
assert_jobs.call('tag push', ['system/start.sh'], [], push.merge('CI_COMMIT_BRANCH' => nil, 'CI_COMMIT_TAG' => 'v1'))
assert_jobs.call('protected semantic version tag runs all acceptance before public release', ['README.md'], runtime + ['deploy:dockerhub'],
                 hub.merge('CI_COMMIT_BRANCH' => nil, 'CI_COMMIT_TAG' => 'v1.2.3'))
assert_jobs.call('protected tag without public release selector still tests fully', ['README.md'], runtime,
                 push.merge('CI_COMMIT_BRANCH' => nil, 'CI_COMMIT_TAG' => 'v1.2.3'))
assert_jobs.call('unprotected semantic version tag cannot publish', ['system/start.sh'], [],
                 hub.merge('CI_COMMIT_BRANCH' => nil, 'CI_COMMIT_TAG' => 'v1.2.3', 'CI_COMMIT_REF_PROTECTED' => 'false'))
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
hub_job = jobs.fetch('deploy:dockerhub')
review_jobs.each do |name|
  job = jobs.fetch(name)
  raise 'Review must remain optional, serialized and manually selected' unless job['allow_failure'] == true && job['resource_group'] == 'wizard-review' &&
    job['stage'] == 'deploy' && job['services'] == [] && job['tags'] == ['docker'] && job['rules'].first['when'] == 'manual' &&
    job['rules'].last == {'when' => 'never'} && !job['needs']
  raise 'Review installation must preserve its finite cleanup reserve' unless job['before_script'] == ['timeout -k 5 110 sh bootstrapper/install-runtime.sh'] &&
    job.dig('variables', 'RUNNER_SCRIPT_TIMEOUT') == '12m' && job['timeout'] == '14m'
end
raise 'Review must reuse the candidate; Stop must survive artifact expiry' unless jobs.fetch('deploy:wizard-review')['dependencies'] == ['test:platform-candidate'] &&
  jobs.fetch('stop:wizard-review')['dependencies'] == [] && jobs.fetch('deploy:wizard-review').dig('environment', 'on_stop') == 'stop:wizard-review' &&
  jobs.fetch('stop:wizard-review').dig('environment', 'action') == 'stop'
mirror_job = jobs.fetch('deploy:github')
raise 'Wizard dependency publication evidence must remain available' unless mirror_job.dig('artifacts', 'paths') == ['test-results/github/'] &&
  mirror_job.dig('artifacts', 'when') == 'always' && mirror_job['script'] == ['sh gitlab/github-backup-ci.sh']
browser_job = jobs.fetch('test:wizard-browser')
raise 'Full native Wizard browser coverage must use an isolated required child' unless browser_job['script'] == ['sh tests/ci-wizard-browser.sh'] &&
  browser_job['after_script'] == ['sh tests/ci-wizard-browser.sh cleanup'] && browser_job['services'] == [] &&
  browser_job['tags'] == ['docker'] && browser_job.dig('artifacts', 'reports', 'junit') == 'test-results/wizard-browser/junit.xml'
raise 'Public release must consume the accepted full candidate without rebuilding' unless hub_job['script'] == ['node gitlab/publish-dockerhub.js'] &&
  hub_job['dependencies'] == ['test:platform-candidate'] && !hub_job['needs'] && hub_job['stage'] == 'deploy'
raise 'Public publisher must retain required protected and serialized execution' unless hub_job['allow_failure'] == false &&
  hub_job['resource_group'] == 'dockerhub-release-$CI_PROJECT_ID' && hub_job['services'] == [] && hub_job['tags'] == ['docker'] &&
  hub_job['interruptible'] == false && hub_job.dig('variables', 'GIT_DEPTH') == '0' &&
  hub_job.fetch('rules').last == {'when' => 'never'} &&
  hub_job.fetch('rules')[0..1].all? { |rule| rule['if'].include?('$CI_COMMIT_REF_PROTECTED == "true"') &&
    rule['if'].include?('$DOCKERHUB_PUBLISH_ENABLED == "true"') && rule['if'].include?('$CI_PIPELINE_SOURCE == "push"') }
raise 'Public release must not upload credentials or broad candidate output' unless hub_job.dig('artifacts', 'paths') == ['test-results/dockerhub/']
build = jobs.fetch('build')
raise 'Private registry base publication changed' unless build['script'] == [
  'docker build --provenance=false --sbom=false -t $IMAGE_TAG ./bootstrapper',
  'docker push $IMAGE_TAG'
] && build['before_script'] == [
  'sh bootstrapper/refresh-ca.sh',
  'echo "$CI_REGISTRY_PASSWORD" | docker login --username $CI_REGISTRY_USER --password-stdin $CI_REGISTRY'
] && config.dig('variables', 'IMAGE_TAG') == '$CI_REGISTRY_IMAGE:$CI_COMMIT_REF_SLUG'
raise 'Pinned Docker job/service images required' unless config['image'].start_with?('docker:29.9.2-cli@sha256:') && config['services'].first.start_with?('docker:29.9.2-dind@sha256:')
raise 'Every native CI parent must refresh public CA trust' unless config.dig('default','before_script') == ['sh bootstrapper/refresh-ca.sh'] && config.dig('variables','NODE_OPTIONS') == '--use-openssl-ca'
raise 'Unexpected mirror dependencies' unless jobs.fetch('deploy:github')['dependencies'] == []
raise 'Mirror context was weakened' unless jobs.fetch('deploy:github')['script'] == ['sh gitlab/github-backup-ci.sh'] &&
  jobs.fetch('deploy:github').fetch('rules').first.fetch('if') == '$GITHUB_BACKUP_ENABLED == "true" && $CI_PIPELINE_SOURCE == "push" && $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && $CI_COMMIT_REF_PROTECTED == "true" && $CI_COMMIT_TAG == null'
puts 'PASS: native YAML event/path selection, artifact closure, required gates, private registry publication, protected public controller/Wizard release and GitHub mirror'
