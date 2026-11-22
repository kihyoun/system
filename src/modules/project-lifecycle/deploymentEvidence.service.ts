import { Injectable } from '@nestjs/common';
import { GitlabCredentialService } from '../gitlab-provision/credential.service';
import { GitlabNativeApiService } from '../gitlab-provision/nativeApi.service';
import { accepted, type EvidenceReader } from './evidenceCommon';
import { verifySystemEvidence } from './systemEvidence';
import { verifyWizardEnvironment, verifyWizardProduction } from './wizardEvidence';
export type DeploymentEvidenceKind = 'production' | 'environment' | 'beta' | 'review';
/** Shared read-only acceptance boundary; no per-check Rails credential programs. */
@Injectable()
export class DeploymentEvidenceService {
  constructor(
    private readonly credentials: GitlabCredentialService,
    private readonly api: GitlabNativeApiService,
  ) {}

  async verify(
    checkout: string,
    kind: DeploymentEvidenceKind,
    input: unknown,
    binding?: unknown,
    signal?: AbortSignal,
  ) {
    const session = await this.credentials.ensure({ checkout, signal });
    const raw = async (route: string) => {
      const response = await this.api.readBytes(session.context, session.credential.token, route);
      accepted(response.status === 200);
      return response.bytes;
    };
    const reader: EvidenceReader = {
      raw,
      get: async (route) => JSON.parse((await raw(route)).toString('utf8')),
    };
    return verifyDeploymentEvidence(reader, kind, input, binding);
  }
}
export async function verifyDeploymentEvidence(
  reader: EvidenceReader,
  kind: DeploymentEvidenceKind,
  input: unknown,
  binding?: unknown,
) {
  try {
    if (kind === 'production') {
      return await verifyWizardProduction(reader, input, binding);
    }

    if (kind === 'environment') {
      return await verifyWizardEnvironment(reader, input);
    }

    accepted(kind === 'beta' || kind === 'review');
    return await verifySystemEvidence(reader, input, kind);
  } catch {
    // Never disclose token-bearing HTTP errors or unknown provider responses.
    throw Error('canonical-deployment-evidence-invalid');
  }
}
