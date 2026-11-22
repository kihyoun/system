import { readSourceIdentity, revision } from '../release/sourceIdentity';
import { HostInstallService, requireValue } from './install';
export class HostSourceService {
  constructor(readonly host = new HostInstallService()) {}

  verifyObjects(input: unknown, checkout: string): void {
    let source;
    try {
      source = readSourceIdentity(input);
    } catch {
      throw Error('invalid-successor-source-identity');
    }
    requireValue(
      this.host
        .run('git', ['-C', checkout, 'rev-parse', source.sourceRevision + '^{tree}'])
        .trim() === source.sourceTree,
      'successor-checkout-tree-mismatch',
    );
    const wizard =
      source.sourceLayout === 'system-monorepo-v1'
        ? '040000 tree ' + source.wizardSourceTree
        : '160000 commit ' + source.wizardRevision;
    requireValue(
      this.host.run('git', ['-C', checkout, 'ls-tree', source.sourceRevision, 'wizard']).trim() ===
        wizard + '\twizard',
      'successor-checkout-gitlink-mismatch',
    );
  }

  verifyCheckout(input: unknown, checkout: string): void {
    let source;
    try {
      source = readSourceIdentity(input);
    } catch {
      throw Error('invalid-successor-source-identity');
    }
    requireValue(
      !this.host.run('git', ['-C', checkout, 'status', '--porcelain']).trim(),
      'successor-checkout-is-modified',
    );
    requireValue(
      this.host.run('git', ['-C', checkout, 'rev-parse', 'HEAD']).trim() === source.sourceRevision,
      'successor-checkout-revision-mismatch',
    );
    this.verifyObjects(source, checkout);
  }

  verifyAncestry(earlier: unknown, later: unknown, checkout: string): void {
    requireValue(revision(earlier) && revision(later), 'staged-controller-source-identity-invalid');
    try {
      this.host.run('git', [
        '--no-replace-objects',
        '-C',
        checkout,
        'merge-base',
        '--is-ancestor',
        earlier,
        later,
      ]);
    } catch {
      throw Error('staged-controller-source-is-not-descendant');
    }
  }
}
