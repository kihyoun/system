import { Injectable } from '@nestjs/common';
import path from 'node:path';
import * as policy from '../../common/ca-policy.mjs';
export type { CaProvenance } from '../../common/ca-policy.mjs';
export const certificates = policy.certificates;
export function readCaProvenance(directory = path.resolve(__dirname, '../../../config/ca')) {
  return policy.readCaProvenance(directory);
}
export function check(values: readonly string[], provenance = readCaProvenance()): number {
  return policy.check(values, provenance);
}
/** The bootstrap entry and installed runtime share the same trust policy. */
@Injectable()
export class CaVerificationService {
  bundle(checkout: string) {
    return policy.verifyBundle(checkout);
  }

  system(
    checkout: string,
    environment: NodeJS.ProcessEnv = process.env,
    execArguments = process.execArgv,
  ) {
    return policy.verifySystem(checkout, environment, execArguments);
  }
}
