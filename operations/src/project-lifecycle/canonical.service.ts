import { Inject, Injectable } from '@nestjs/common';
import { CanonicalPayload, CanonicalSession } from './canonical-session';
@Injectable()
export class CanonicalService {
  constructor(@Inject(CanonicalSession) private readonly session: CanonicalSession) {}
  run(action: string, payload: CanonicalPayload) {
    return this.session.run(action, payload);
  }
}
