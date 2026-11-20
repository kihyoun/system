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
        import base64
        value = successor.recovery.host_operation('publicReleaseInputs', metadata,
            base64.b64encode(proof_bytes).decode(), security)
        self.graph, self.proof = value['graph'], value['proof']
        self.release, self.evidence = value['release'], value['evidence']
        self.release_bytes = base64.b64decode(value['releaseBytes'])
        self.evidence_bytes = base64.b64decode(value['evidenceBytes'])

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
