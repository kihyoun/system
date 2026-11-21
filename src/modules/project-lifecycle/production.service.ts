import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import { Promotion } from './production-session';
@Injectable()
export class ProductionService {
  constructor(@Inject(Promotion) private readonly promotion: Promotion) {}

  async run(args: string[]) {
    const [action, file, confirmation] = args;
    if (args.length > 3) throw new Error('Invalid Production invocation.');
    if (action === 'plan' && file && !confirmation) {
      const result = await this.promotion.plan(JSON.parse(fs.readFileSync(file, 'utf8')));
      return { ...result.publicPlan, planHash: result.planHash };
    }
    if (action === 'apply' && file && confirmation)
      return this.promotion.apply(JSON.parse(fs.readFileSync(file, 'utf8')), confirmation);
    if (action === 'recover-plan' && !file) {
      const result = this.promotion.recoveryPlan();
      return { ...result.publicPlan, planHash: result.planHash };
    }
    if (action === 'recover' && file && !confirmation) return this.promotion.recover(file);
    if (action === 'rollback-plan' && !file) {
      const result = await this.promotion.rollbackPlan();
      return { ...result.publicPlan, planHash: result.planHash };
    }
    if (action === 'rollback' && file && !confirmation) {
      const result = await this.promotion.rollbackPlan();
      return this.promotion.apply(result.proof, file, true);
    }
    throw new Error(
      'Usage: run.js plan PROOF | apply PROOF PLAN_HASH | rollback-plan | rollback PLAN_HASH | recover-plan | recover PLAN_HASH',
    );
  }
}
