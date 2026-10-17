require 'yaml'
before = YAML.load_file('/evidence/original-integrated-ci.yml')
after = YAML.load_file('/ci.yml')
%w[image services variables cache build deploy:dockerhub deploy:github].each do |key|
  raise "Upstream changed: #{key}" unless before[key] == after[key]
end
raise 'Stage order' unless after['stages'] == %w[prepare test build deploy]
prepare = after.fetch('prepare:wizard-source')
test = after.fetch('test:isolated')
raise 'Preparation contract' unless prepare['stage'] == 'prepare' && prepare['variables']['GIT_SUBMODULE_STRATEGY'] == 'recursive' && prepare['services'] == []
raise 'Artifact path' unless prepare['artifacts']['paths'] == ['project-bootstrap/wizard-source/snapshot.json']
raise 'Required dependency' unless test['dependencies'] == ['prepare:wizard-source'] && test['allow_failure'] == false
raise 'Trigger compatibility' unless test['only'] == prepare['only']
raise 'Digest pins' unless prepare['image'].include?('@sha256:') && test['image'].include?('@sha256:')
puts 'PASS: CI YAML artifact dependency, recursive pinned preparation, digest images and unchanged upstream jobs.'
