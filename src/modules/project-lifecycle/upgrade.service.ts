import { Inject, Injectable } from '@nestjs/common';
import { Upgrade } from './upgrade-session';
@Injectable()
export class UpgradeService {
  constructor(@Inject(Upgrade) private readonly session: Upgrade) {}

  async run(action: string, confirmation?: string) {
    const buildOnly = action.startsWith('build-'),
      command = buildOnly ? action.slice(6) : action;
    if (command === 'plan' || command === 'adoption-plan') {
      const result = await (command === 'plan'
        ? this.session.plan(buildOnly)
        : this.session.adoptionPlan(buildOnly));
      return { plan: result.publicPlan, planHash: result.planHash };
    }
    if ((command === 'stage' || command === 'adopt') && confirmation)
      return this.session[command](confirmation, buildOnly);
    throw Error(
      'Use plan, stage, adoption-plan or adopt; prefix build- for the source-preserving recipe upgrade.',
    );
  }
}
