import { Injectable } from '@nestjs/common';
import { DeploymentSession } from './deploymentSession';
import { DeploymentAction, DeploymentPort, DeploymentSlot } from './types';
@Injectable()
export class ProjectLifecycleService {
  execute(port: DeploymentPort, action: DeploymentAction, slot: DeploymentSlot, imageRef?: string) {
    const session = new DeploymentSession(port);

    if (action === 'deploy') {
      if (!imageRef) {
        throw new Error('Immutable deployment image is required.');
      }

      return session.deploy(slot, imageRef);
    }

    return session[action](slot);
  }
}
