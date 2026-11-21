import { Inject, Injectable } from '@nestjs/common';
import { Adoption } from './adoption-session';
@Injectable()
export class AdoptionService {
  constructor(@Inject(Adoption) private readonly session: Adoption) {}

  async run(command: string, input: unknown, confirmation?: string) {
    if (command === 'plan') {
      const value = await this.session.plan(input);
      return { ...value.publicPlan, planHash: value.planHash };
    }
    if (command === 'apply' && confirmation) return this.session.apply(input, confirmation);
    throw Error(
      'Use plan or apply with an exact input, private credential file and confirmation hash.',
    );
  }
}
