require 'json'
require 'base64'
require 'net/http'
require 'uri'
require 'open3'
require 'date'
require 'stringio'
class BootstrapError < StandardError; end
def Date.tomorrow = today + 1 unless Date.respond_to?(:tomorrow)
load File.expand_path('../../project-bootstrap/preview-setup/provision.rb', __dir__)

# Node's adoption fixture uses the actual Ruby collector, without Rails or HTTP.
if ARGV == ['--collect']
  data = JSON.parse($stdin.read)
  api = lambda do |method, route, _body|
    raise 'Collector attempted a mutation' unless method == Net::HTTP::Get
    [200, data.fetch('rows').fetch(route)]
  end
  puts JSON.generate(BootstrapperPreviewSetup.new(api, data.fetch('input')).call)
  exit
end

sha = 'a' * 40
pipeline = {'id' => 31, 'sha' => sha, 'ref' => 'main/native', 'source' => 'push', 'status' => 'success'}
jobs = ['build:source', 'test:browser', 'build:wizard', 'test:wizard'].each_with_index.map do |name, index|
  {'id' => 40 + index, 'name' => name, 'status' => 'success', 'allow_failure' => false,
    'commit' => {'id' => sha}, 'pipeline' => {'id' => 31}}
end
files = ['.gitlab/primary.yml', *Array.new(22) { |index| ".gitlab/proof-#{index}.sh" }].map do |name|
  {'path' => name, 'sha256' => Digest::SHA256.hexdigest('fixture bytes')}
end
project = {'id' => 7, 'namespace' => {'id' => 9}, 'path_with_namespace' => 'team/wizard',
  'default_branch' => 'main/native', 'visibility' => 'private', 'ci_config_path' => '.gitlab/primary.yml',
  'only_allow_merge_if_pipeline_succeeds' => true, 'only_allow_merge_if_all_discussions_are_resolved' => true}
repository = {'id' => 7, 'namespaceId' => 9, 'path' => 'team/wizard', 'defaultBranch' => 'main/native',
  'managementMode' => 'source-primary', 'ciPath' => '.gitlab/primary.yml'}
receipt = {'namespaceId' => 9, 'repository' => repository, 'sourcePrimary' => {'ciFiles' => files}}
input = {'action' => 'preview-setup-adoption-evidence', 'projectIds' => [1, 7], 'previousProjectId' => 1,
  'receipt' => receipt, 'pipelineId' => 31, 'sourceCommit' => sha}
branch = 'projects/7/repository/branches/main%2Fnative'
pipeline_route = "projects/7/pipelines?sha=#{sha}&ref=main%2Fnative&source=push&per_page=100"
jobs_route = 'projects/7/pipelines/31/jobs?per_page=100&include_retried=false'
rows = {'projects/1' => {'id' => 1}, 'projects/7' => project, branch => {'commit' => {'id' => sha}},
  'projects/7/pipelines/31' => pipeline, jobs_route => jobs, pipeline_route => [pipeline],
  "projects/7/repository/tree?path=.gitlab&ref=#{sha}&recursive=true&per_page=100" => files.map { |file| {'type' => 'blob', 'path' => file.fetch('path')} },
  "projects/7/repository/tree?path=.system-bootstrapper%2Fbuild-v1&ref=#{sha}&recursive=true&per_page=100" => []}
files.each do |file|
  rows['projects/7/repository/files/' + URI.encode_www_form_component(file.fetch('path')) + '?ref=' + sha] =
    {'content' => Base64.strict_encode64('fixture bytes')}
end
rows['projects/7/jobs/42/artifacts/build-evidence.json'] = {'version' => 1}
rows['projects/7/jobs/43/artifacts/wizard-evidence.json'] = {'version' => 1}
calls = []
api = lambda do |method, route, _body|
  raise 'Collector attempted a mutation' unless method == Net::HTTP::Get
  calls << route
  [200, JSON.parse(JSON.generate(rows.fetch(route)))]
end
read = lambda do |selected = input|
  calls.clear
  BootstrapperPreviewSetup.new(api, selected).call
end
result = read.call
raise 'Adoption phase did not preserve all 30 GETs in order' unless result[:reads].map { |row| row[:route] } == calls && calls.length == 30
raise 'Collector exceeded aggregate output budget' unless JSON.generate(result).bytesize <= 1500000
read.call
raise 'Another phase reused old GET responses' unless calls.length == 30
source_input = {'action' => 'preview-setup-source-evidence', 'projectIds' => [7], 'projectId' => 7}
result = read.call(source_input)
raise 'Source discovery lost its context, artifact or exact manifest blobs' unless calls.length == 30 && result[:files].map { |file| file[:path] } == files.map { |file| file['path'] } && result[:artifact] == {'version' => 1}
rows[pipeline_route][0]['status'] = 'running'
result = read.call(source_input)
raise 'Waiting discovery read unverified jobs/artifacts' unless calls.length == 3 && !result.key?(:files)
rows[pipeline_route][0]['status'] = 'success'

# Exercise the same native pipeline gate against JavaScript's authoritative
# binding validator, including its narrowly permitted optional mirror failure.
cases = []
cases << [pipeline, jobs]
['created', 'running', 'failed', 'canceled', 'skipped', 'unknown'].each do |status|
  cases << [pipeline.merge('status' => status), jobs]
end
jobs.each_index do |index|
  [{'status' => 'failed'}, {'allow_failure' => true}, {'commit' => {'id' => 'b' * 40}}, {'pipeline' => {'id' => 32}}].each do |change|
    changed = JSON.parse(JSON.generate(jobs)); changed[index].merge!(change); cases << [pipeline, changed]
  end
  cases << [pipeline, jobs.reject.with_index { |_job, current| current == index }]
  cases << [pipeline, jobs + [jobs[index]]]
end
mirror = {'id' => 50, 'name' => 'deploy:github', 'status' => 'failed', 'allow_failure' => false,
  'commit' => {'id' => sha}, 'pipeline' => {'id' => 31}}
cases << [pipeline.merge('status' => 'failed'), jobs + [mirror]]
cases << [pipeline, jobs + [mirror.merge('allow_failure' => true)]]
cases << [pipeline, jobs + [mirror, mirror]]
cases << [pipeline, jobs + [mirror.merge('commit' => {'id' => 'b' * 40})]]
cases << [pipeline, jobs + [mirror.merge('name' => 'another-required-job')]]
javascript = "const b=require(process.argv[1]);let s='';process.stdin.on('data',p=>s+=p);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(s).map(([p,j])=>{try{b.pipelineChecks(p,j);return true;}catch{return false;}}))));"
output, error, status = Open3.capture3('node', '-e', javascript,
  File.expand_path('../../project-bootstrap/wizard-source-primary/binding.js', __dir__), stdin_data: JSON.generate(cases))
raise 'JavaScript gate parity witness failed: ' + error unless status.success?
expected = JSON.parse(output)
cases.each_with_index do |(candidate, selected_jobs), index|
  helper = BootstrapperPreviewSetup.new(api, input)
  accepted = begin helper.pipeline_checks(candidate, selected_jobs); true; rescue BootstrapError; false; end
  raise 'Native and JavaScript job gates differ' unless accepted == expected[index]
  next if accepted
  rows['projects/7/pipelines/31'] = candidate
  rows[pipeline_route] = [candidate]
  rows[jobs_route] = selected_jobs
  [input, source_input].each do |selected|
    if selected == source_input && !['success', 'failed'].include?(candidate['status'])
      read.call(selected)
      raise 'Waiting discovery read artifacts' unless calls.length == 3
      next
    end
    begin
      read.call(selected)
      raise 'Invalid pipeline/jobs were accepted'
    rescue BootstrapError
      raise 'Invalid jobs read artifacts or manifest content' if calls.any? { |route| route.include?('/artifacts/') || route.include?('/repository/files/') }
    end
  end
end
rows['projects/7/pipelines/31'] = pipeline
rows[pipeline_route] = [pipeline]
rows[jobs_route] = jobs
[nil, false, '', 0].each do |yaml_errors|
  rows['projects/7/pipelines/31'] = pipeline.merge('yaml_errors' => yaml_errors)
  read.call
end
rows['projects/7/pipelines/31'] = pipeline
[
  ['projects/7', project.merge('visibility' => 'public')],
  [branch, {'commit' => {'id' => 'b' * 40}}],
  ['projects/7/pipelines/31', pipeline.merge('id' => 32)],
  ['projects/7/pipelines/31', pipeline.merge('ref' => 'other')],
  ['projects/7/pipelines/31', pipeline.merge('source' => 'api')],
  ['projects/7/pipelines/31', pipeline.merge('yaml_errors' => 'invalid')]
].each do |route, changed|
  original = rows[route]; rows[route] = changed
  begin
    read.call
    raise 'Changed project/branch/pipeline identity was accepted'
  rescue BootstrapError
    raise 'Changed identity read artifacts' if calls.any? { |value| value.include?('/artifacts/') }
  ensure rows[route] = original
  end
end
first_blob = 'projects/7/repository/files/.gitlab%2Fprimary.yml?ref=' + sha
original = rows[first_blob]
rows[first_blob] = {'content' => Base64.strict_encode64('changed bytes')}
begin
  read.call
  raise 'Changed manifest bytes were accepted'
rescue BootstrapError
  raise 'Changed manifest read artifacts' if calls.any? { |route| route.include?('/artifacts/') }
ensure rows[first_blob] = original
end
rows[first_blob] = {'content' => Base64.strict_encode64('x' * 1500000)}
begin
  read.call
  raise 'Oversized source evidence was accepted'
rescue BootstrapError
  raise 'Oversized evidence continued fetching' unless calls.length == 6
ensure rows[first_blob] = original
end
[input.merge('projectIds' => [1]), input.merge('previousProjectId' => 8),
 input.merge('receipt' => receipt.merge('sourcePrimary' => {'ciFiles' => files + files.take(3)}))].each do |selected|
  begin
    read.call(selected)
    raise 'Unscoped or oversized collector input was accepted'
  rescue BootstrapError
    raise 'Invalid collector input read GitLab' unless calls.empty?
  end
end
# The exact existing 32-GET limit is inclusive; larger manifests keep the old
# bounded discovery path instead of widening the collector's input budget.
tree = rows["projects/7/repository/tree?path=.gitlab&ref=#{sha}&recursive=true&per_page=100"]
larger_files = Array.new(2) { |index| {'path' => ".gitlab/larger-#{index}.sh", 'sha256' => Digest::SHA256.hexdigest('fixture bytes')} }
larger_files.each do |file|
  tree << {'type' => 'blob', 'path' => file['path']}
  rows['projects/7/repository/files/' + URI.encode_www_form_component(file['path']) + '?ref=' + sha] = {'content' => Base64.strict_encode64('fixture bytes')}
end
boundary = input.merge('receipt' => receipt.merge('sourcePrimary' => {'ciFiles' => files + larger_files}))
read.call(boundary)
raise 'Inclusive adoption GET budget changed' unless calls.length == 32
read.call(source_input)
raise 'Inclusive discovery GET budget changed' unless calls.length == 32
tree << {'type' => 'blob', 'path' => '.gitlab/too-large.sh'}
result = read.call(source_input)
raise 'Larger discovery bypassed its bounded fallback' unless calls.length == 6 && !result.key?(:files)

# The real production dispatcher still owns and revokes its temporary PAT on
# successful, refused, oversized and interrupted collector invocations.
User = Class.new unless defined?(User)
minted = revoked = 0
tokens = Object.new
tokens.define_singleton_method(:where) { |*_args| self }
tokens.define_singleton_method(:find_each) { nil }
tokens.define_singleton_method(:create!) do |*_args|
  minted += 1
  token = Object.new
  token.define_singleton_method(:token) { 'private-fixture-collector-token' }
  token.define_singleton_method(:revoke!) { revoked += 1 }
  token
end
admin = Object.new
admin.define_singleton_method(:admin?) { true }
admin.define_singleton_method(:active?) { true }
admin.define_singleton_method(:personal_access_tokens) { tokens }
User.define_singleton_method(:find_by_username) { |_name| admin }
original_start = Net::HTTP.method(:start)
begin
  [input, source_input].each do |selected|
    [:success, :invalid_scope, :oversized, :transport_loss].each do |scenario|
      network = 0
      http = Object.new
      http.define_singleton_method(:request) do |request|
        network += 1
        raise IOError, 'private-fixture-collector-token' if scenario == :transport_loss
        route = request.path.delete_prefix('/api/v4/')
        value = scenario == :oversized ? {'padding' => 'x' * 1500000} : rows.fetch(route)
        Struct.new(:code, :body).new('200', JSON.generate(value))
      end
      Net::HTTP.define_singleton_method(:start) { |*_args, **_options, &block| block.call(http) }
      value = scenario == :invalid_scope ? selected.merge('projectIds' => []) : selected
      Object.send(:remove_const, :BOOTSTRAPPER_INPUT) if defined?(BOOTSTRAPPER_INPUT)
      Object.const_set(:BOOTSTRAPPER_INPUT, Base64.strict_encode64(JSON.generate(value)))
      previous_stdout, $stdout = $stdout, StringIO.new
      begin
        load File.expand_path('../../project-bootstrap/provision.rb', __dir__)
        text = $stdout.string
      ensure $stdout = previous_stdout
      end
      raise 'Collector credential cleanup was not witnessed' unless minted == revoked
      raise 'Collector credential escaped native diagnostics' if text.include?('private-fixture-collector-token')
      result = JSON.parse(text)
      raise 'Native collector dispatcher lost success' if scenario == :success && result['state'] == 'failed'
      raise 'Native collector dispatcher accepted an invalid call' if scenario != :success && result['state'] != 'failed'
      raise 'Collector started HTTP before scope validation' if scenario == :invalid_scope && network != 0
      raise 'Collector exceeded its existing GET budget' if network > 32
    end
  end
ensure Net::HTTP.define_singleton_method(:start, original_start)
end
puts "Preview evidence collectors: unchanged 30-GET phases, #{cases.length} exact native/JS job-gate cases, fresh reads, no pre-gate artifacts, identity/hash/scope/size refusals and larger-manifest fallback passed."
