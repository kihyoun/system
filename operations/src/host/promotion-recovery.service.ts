import { PromotionAbortService } from './promotion-abort.service';
import {
  PromotionNativePortService,
  type PromotionNativeInput,
} from './promotion-native-port.service';
/** API and CLI share one recovery operation and its durable native ownership. */
export class PromotionRecoveryService {
  private active = false;
  constructor(
    readonly port: PromotionNativePortService,
    readonly abortSequence: PromotionAbortService,
  ) {}
  async abort(input: PromotionNativeInput): Promise<void> {
    if (this.active) throw Error('promotion-recovery-already-running');
    this.active = true;
    let failed = true;
    try {
      const prepared = await this.port.prepare(input);
      await this.abortSequence.run(prepared);
      failed = false;
    } finally {
      try {
        this.port.finish(failed);
      } finally {
        this.active = false;
      }
    }
  }
}
