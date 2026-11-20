"""Public publisher authority; never impersonates the operator's GitLab API.

The trust anchor is the operator-selected GitHub repository over authenticated
HTTPS. Asset hashes bind a single publication; they are not detached signatures.
"""
import json
import successor

require = successor.require


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode()


def fetch(repository, tag, filename):
    import base64
    return base64.b64decode(successor.recovery.host_operation('publicReleaseAsset', repository, tag, filename))


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
