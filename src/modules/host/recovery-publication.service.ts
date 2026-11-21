import { readSourceIdentity, record, imageId } from '../release/source-identity';
import { requireValue as ensure, type InstalledSource } from './install';
import { canonicalDigest } from './recovery-manifest';
export function recoverySource(input: unknown): InstalledSource {
  const value: Record<string, unknown> = Array.isArray(input)
    ? { sourceCommit: input[0], sourceTree: input[1], wizardSourceRevision: input[2] }
    : record(input);
  const source = readSourceIdentity({
    sourceRevision: value.sourceCommit,
    sourceTree: value.sourceTree,
    sourceLayout: value.sourceLayout,
    wizardSourceTree: value.wizardSourceTree,
    wizardRevision: value.wizardSourceRevision,
  });
  return source.sourceLayout === 'system-monorepo-v1'
    ? {
        sourceCommit: source.sourceRevision,
        sourceTree: source.sourceTree,
        sourceLayout: source.sourceLayout,
        wizardSourceTree: source.wizardSourceTree,
      }
    : {
        sourceCommit: source.sourceRevision,
        sourceTree: source.sourceTree,
        wizardSourceRevision: source.wizardRevision,
      };
}
export function releaseInstalledSource(input: unknown): InstalledSource {
  const source = readSourceIdentity(input);
  return recoverySource({
    sourceCommit: source.sourceRevision,
    sourceTree: source.sourceTree,
    sourceLayout: source.sourceLayout,
    wizardSourceTree: source.wizardSourceTree,
    wizardSourceRevision: source.wizardRevision,
  });
}
export class RecoveryPublicationService {
  refresh(
    previous: unknown,
    archive: unknown,
    sourceValue: unknown,
    controllerReference: string,
    controllerImage: string,
    gitlabReference: string,
    gitlabImage: string,
    wizardReference: string,
    runnerReference?: string,
    runnerImage?: string,
  ): Record<string, unknown> {
    const source = recoverySource(sourceValue),
      value = record(structuredClone(previous));
    ensure(imageId(controllerImage) && imageId(gitlabImage), 'invalid-current-recovery-images');
    if (value.currentController) {
      const history = value.controllerHistory ?? [];
      ensure(Array.isArray(history), 'invalid-controller-history');
      history.push(structuredClone(value.currentController));
      value.controllerHistory = history;
    }
    ensure(
      Array.isArray(value.archives) &&
        Array.isArray(value.localImages) &&
        Array.isArray(value.publicImages),
      'invalid-recovery-manifest-images',
    );
    const rows = value.archives.map(record),
      matches = rows.filter((row) => row.imageId === controllerImage);
    ensure(matches.length <= 1, 'duplicate-current-controller-archive');
    value.archives = matches.length
      ? rows.map((row) => (row === matches[0] ? archive : row))
      : [...rows, archive];
    const aliases = ['system_bootstrapper', controllerReference];
    value.localImages = [
      ...value.localImages.map(record).filter((row) => !aliases.includes(String(row.tag))),
      ...Array.from(new Set(aliases))
        .sort()
        .map((tag) => ({ tag, imageId: controllerImage })),
    ];
    const replace = (reference: string, id: string, code: string) => {
      const repository = canonicalDigest(reference).split('@')[0],
        publicImages = (value.publicImages as unknown[]).map(record);
      const previous = publicImages.filter(
        (row) => canonicalDigest(String(row.reference)).split('@')[0] === repository,
      );
      ensure(previous.length, code);
      value.publicImages = [
        ...publicImages.filter((row) => !previous.includes(row)),
        { reference, tag: reference.split('@')[0], imageId: id },
      ];
    };
    replace(gitlabReference, gitlabImage, 'existing-GitLab-public-image-declaration-required');
    if (runnerReference !== undefined) {
      ensure(imageId(runnerImage), 'invalid-current-runner-image');
      replace(runnerReference, runnerImage, 'existing-Runner-public-image-declaration-required');
    }
    for (const key of ['wizardSourceRevision', 'sourceLayout', 'wizardSourceTree'])
      delete value[key];
    Object.assign(value, source, { deployedCodeTree: source.sourceTree });
    value.currentController = {
      imageId: controllerImage,
      reference: controllerReference,
      sourceCommit: source.sourceCommit,
      sourceTree: source.sourceTree,
      archive: record(archive).file,
      productionWizardReference: wizardReference,
      ...(source.sourceLayout
        ? { sourceLayout: source.sourceLayout, wizardSourceTree: source.wizardSourceTree }
        : { packagedWizardSourceRevision: source.wizardSourceRevision }),
    };
    return value;
  }
}
