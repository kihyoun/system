"""Public publisher authority; never impersonates the operator's GitLab API.

The trust anchor is the operator-selected GitHub repository over authenticated
HTTPS. Asset hashes bind a single publication; they are not detached signatures.
"""
import hashlib
import json
import re
import urllib.request
import urllib.parse
import successor
from upgrade_paths import validate

require = successor.require
MAXIMUM = 8 * 1024 ** 2


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def fetch(repository, tag, filename):
    require(re.fullmatch(r'[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+', repository or '') and
            all(part not in ('.', '..') for part in repository.split('/')) and
            re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+', tag or '') and
            re.fullmatch(r'[A-Za-z0-9._-]+', filename or '') and filename not in ('.', '..'), 'invalid-public-release-location')
    # GitHub's release CDN redirects are anonymous and restricted to TLS hosts.
    class Redirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            parsed = urllib.parse.urlsplit(newurl)
            require(parsed.scheme == 'https' and parsed.hostname in
                    ('github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com') and
                    not parsed.username and not parsed.password and parsed.port in (None, 443),
                    'unapproved-public-release-redirect')
            return super().redirect_request(req, fp, code, msg, headers, newurl)
    url = 'https://github.com/' + repository + '/releases/download/' + tag + '/' + filename
    with urllib.request.build_opener(Redirect()).open(url, timeout=30) as response:
        result = response.read(MAXIMUM + 1)
    require(len(result) <= MAXIMUM, 'public-release-asset-too-large')
    return result


class PublicReleaseAuthority:
    def __init__(self, metadata, proof_bytes, base, security):
        self.metadata, self.base = metadata, base
        descriptor = metadata.get('publicUpgrade', {})
        require(metadata.get('format') == 'system-accepted-release-v1' and
                descriptor.get('format') == 'system-public-upgrade-provenance-v1' and
                descriptor.get('file') == 'system-upgrade-v' + metadata.get('version', '') + '.json' and
                descriptor.get('sha256') == hashlib.sha256(proof_bytes).hexdigest(),
                'public-upgrade-provenance-hash-mismatch')
        value = json.loads(proof_bytes)
        require(value.get('format') == descriptor['format'] and value.get('version') == metadata['version'] and
                value.get('source') == metadata.get('source') and value.get('images') == metadata.get('images') and
                value.get('originalEvidenceSha256') == metadata.get('acceptance', {}).get('evidenceSha256') and
                metadata['acceptance'].get('requiredChecksPassed') is True and
                metadata['acceptance'].get('controllerWizardSameAttempt') is True,
                'public-upgrade-publisher-identity-mismatch')
        self.graph = validate(value['graph'])
        self.proof = value
        self.release_bytes, self.evidence_bytes = encoded(value['release']), encoded(value['evidence'])
        self.release, self.evidence = successor.release_inputs(self.release_bytes, self.evidence_bytes, security)
        r = self.release
        require(all(r[key] == metadata['source'][field] for key, field in
                    [('sourceRevision', 'revision'), ('sourceTree', 'tree'), ('wizardRevision', 'wizardRevision')]) and
                all(r[key] == metadata['images'][role]['imageId'] == metadata['images'][role]['configDigest'] for role, key in
                    [('controller', 'imageId'), ('wizard', 'wizardImageId')]) and
                r['registryReference'] == metadata['images']['controller']['reference'] and
                r['wizardRegistryReference'] == metadata['images']['wizard']['reference'] and
                r['candidateJobId'] == metadata['acceptance']['candidateJobId'],
                'public-upgrade-candidate-identity-mismatch')
        publication = value.get('publication', {})
        require(all(publication.get(key) is True for key in
                    ('protectedDefaultBranch', 'requiredMergeGate', 'nativePush')), 'public-upgrade-required-gates-missing')
        jobs = publication.get('jobs', [])
        names = [job.get('name') for job in jobs]
        required = set(successor.REQUIRED_JOBS) | {'test:wizard-browser', 'test:codeql', 'deploy:dockerhub', 'deploy:github'}
        required |= {'test:isolated: [' + component + ']' for component in successor.COMPONENTS}
        require(len(names) == len(set(names)) and required <= set(names), 'public-upgrade-required-jobs-missing')
        for job in jobs:
            require(type(job.get('id')) is int and job['id'] > 0 and job.get('status') == 'success' and
                    job.get('allow_failure') is False and job.get('pipelineId') == r['pipelineId'] and
                    job.get('sourceRevision') == r['sourceRevision'], 'public-upgrade-job-identity-mismatch')
        require(next(j for j in jobs if j['name'] == 'test:platform-candidate')['id'] == r['candidateJobId'],
                'public-upgrade-candidate-job-mismatch')
        for edge in self.graph['transitions']:
            if edge['to'] != metadata['version']:
                continue
            stages = [stage for stage in self.evidence['results'] if stage['name'] == edge['requiredStage']]
            tested = self.evidence['evidence'].get('publicUpgrade', {})
            require(len(stages) == 1 and stages[0]['status'] == 'passed' and tested.get('fromVersion') == edge['from'] and
                    tested.get('toVersion') == edge['to'] and successor.recovery.git_id(tested.get('fromSourceRevision')) and
                    all(successor.recovery.image_id(tested.get(key)) for key in ('fromControllerImageId', 'fromWizardImageId')) and
                    all(tested.get(key) is True for key in
                    ('dataPreserved', 'configurationPreserved', 'runnerRegistryVerified', 'rollbackVerified')),
                    'public-upgrade-transition-not-tested')

    def verify_pipeline(self, release, release_bytes, evidence_bytes):
        require(release == self.release and release_bytes == self.release_bytes and evidence_bytes == self.evidence_bytes,
                'public-upgrade-accepted-inputs-changed')
        return {'authority': 'public-github-release', 'version': self.metadata['version'],
                'sourceRevision': release['sourceRevision'], 'pipelineId': release['pipelineId'],
                'candidateJobId': release['candidateJobId'], 'provenanceSha256': self.metadata['publicUpgrade']['sha256']}

    def verify_pair(self, release, evidence, controller, wizard):
        require(release == self.release and evidence == self.evidence and
                controller.removeprefix('docker.io/') == self.metadata['images']['controller']['reference'].removeprefix('docker.io/') and
                wizard.removeprefix('docker.io/') == self.metadata['images']['wizard']['reference'].removeprefix('docker.io/'), 'public-upgrade-pair-changed')
        return {'authority': 'public-github-release', 'provenanceSha256': self.metadata['publicUpgrade']['sha256']}
