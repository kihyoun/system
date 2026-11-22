import fs from 'node:fs';
import path from 'node:path';

/** Thin command adapters. Every operation belongs to its shared feature module. */
export async function applicationCommand(command: string, args: string[]): Promise<boolean> {
  switch (command) {
    case 'project-ci': {
      const { main } = await import('../modules/project-ci/entry.js');
      const abort = new AbortController();
      const cancel = () => abort.abort();
      const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
      for (const signal of signals) {
        process.on(signal, cancel);
      }
      try {
        await main(args, process.env, abort.signal);
      } finally {
        for (const signal of signals) {
          process.off(signal, cancel);
        }
      }
      return true;
    }
    case 'api': {
      if (args.length) {
        throw Error('unexpected-api-arguments');
      }

      const { bootstrap } = await import('../api/bootstrap.js');
      await bootstrap();
      return true;
    }
    case 'default-wizard': {
      if (args.length) {
        throw Error('unexpected-default-wizard-arguments');
      }

      const { defaultWizardMain } = await import('../api/projects/defaultWizard.js');
      await defaultWizardMain();
      return true;
    }
    case 'host-bootstrap': {
      const { main } = await import('../modules/host-bootstrap/entry.js');
      await main(args);
      return true;
    }
    case 'lifecycle': {
      const { main } = await import('../modules/lifecycle/entry.js');
      await main(args);
      return true;
    }
    case 'storage': {
      const { main, reportFailure } = await import('../modules/storage/entry.js');
      try {
        await main(args);
      } catch (error) {
        reportFailure(error, args);
      }
      return true;
    }
    case 'seed-manifest': {
      const { main } = await import('../modules/storage/manifestEntry.js');
      main(args);
      return true;
    }
    case 'configuration': {
      const { main } = await import('../modules/configuration/entry.js');
      await main(args);
      return true;
    }
    case 'projects-routing': {
      const { main } = await import('../modules/projects-routing/entry.js');
      await main(args[0], args.slice(1));
      return true;
    }
    case 'gitlab-provision': {
      const { main } = await import('../modules/gitlab-provision/entry.js');
      await main(args);
      return true;
    }
    case 'gitlab-preflight': {
      const { main } = await import('../modules/gitlab-preflight/entry.js');
      await main(args);
      return true;
    }
    case 'gitlab-maintenance': {
      const { main } = await import('../modules/gitlab-upgrade/entry.js');
      await main(args);
      return true;
    }
    case 'public-gitlab-prerequisite-helper': {
      const { publicGitlabHelperMain } =
        await import('../modules/host/publicGitlabPrerequisiteHelperEntry.js');
      await publicGitlabHelperMain(args);
      return true;
    }
    case 'public-settings': {
      const { publicSettingsMain } = await import('../modules/lifecycle/publicSettingsEntry.js');
      await publicSettingsMain(args);
      return true;
    }
    case 'record-source-installation': {
      const { recordSourceInstallationMain } =
        await import('../modules/lifecycle/sourceInstallationEntry.js');
      await recordSourceInstallationMain(args);
      return true;
    }
    case 'wizard-environments': {
      const { wizardEnvironmentsMain } = await import('../modules/wizard-environments/entry.js');
      console.log(JSON.stringify(await wizardEnvironmentsMain(args)));
      return true;
    }
    case 'project-environments': {
      const { parse } = await import('../modules/project-lifecycle/environmentRuntime.js');
      const { environmentMain } = await import('../modules/project-lifecycle/environmentEntry.js');
      console.log(JSON.stringify(await environmentMain(parse(args))));
      return true;
    }
    case 'helper-inventory-verify': {
      if (args.length !== 1) {
        throw Error('helper-inventory-hash-required');
      }

      const { verifyHelperTree } = await import('../modules/project-lifecycle/helperInventory.js');
      process.stdout.write(verifyHelperTree(args[0]));
      return true;
    }
    case 'project-environments-canonical': {
      if (args.length) {
        throw Error('canonical-input-uses-stdin');
      }

      const { canonicalStdin } = await import('../modules/project-lifecycle/canonicalEntry.js');
      canonicalStdin();
      return true;
    }
    case 'project-environments-cleanup': {
      if (args.length !== 1) {
        throw Error('cleanup-operation-required');
      }

      const { cleanupStopped } = await import('../modules/project-lifecycle/environmentEntry.js');
      console.log(JSON.stringify(await cleanupStopped(args[0])));
      return true;
    }
    case 'preview-setup': {
      const { main } = await import('../modules/project-lifecycle/previewOperatorEntry.js');
      console.log(JSON.stringify(await main(args)));
      return true;
    }
    case 'system-beta': {
      const entry = await import('../modules/project-lifecycle/systemBetaEntry.js');

      if (args[0] === 'bind') {
        console.log(JSON.stringify(await entry.main(args.slice(1))));
      } else if (args[0] === 'run' && args.length === 2) {
        const { writeEnvironment } =
          await import('../modules/project-lifecycle/systemBetaSession.js');
        writeEnvironment(await entry.run(args[1]));
      } else {
        throw Error('system-beta-bind-or-run-required');
      }

      return true;
    }
    case 'system-review': {
      if (args.length !== 1 || args[0] !== 'stop') {
        throw Error('legacy-system-review-stop-only');
      }

      const { stopReview } = await import('../modules/project-lifecycle/systemBetaEntry.js');
      await stopReview('stop');
      return true;
    }
    case 'wizard-production': {
      const { productionMain } = await import('../modules/project-lifecycle/productionEntry.js');
      console.log(JSON.stringify(await productionMain(args)));
      return true;
    }
    case 'wizard-source-primary': {
      const { main } = await import('../modules/project-lifecycle/adoptionEntry.js');
      console.log(JSON.stringify(await main(args)));
      return true;
    }
    case 'wizard-upgrade': {
      const { upgradeMain } = await import('../modules/project-lifecycle/upgradeEntry.js');
      console.log(JSON.stringify(await upgradeMain(args)));
      return true;
    }
    case 'source-checkout': {
      if (args.length > 1) {
        throw Error('source-checkout-one-root-required');
      }

      const { wizardSourcePreparationMain } =
        await import('../modules/source-preparation/wizardSourceEntry.js');
      await wizardSourcePreparationMain(process.env, args[0] || process.cwd());
      console.log('Wizard source checkout verified at the committed source layout.');
      return true;
    }
    case 'source-prepare': {
      const root = path.resolve(args[0] || process.cwd());

      if (args.length > 2 || (args[1] && !['--verify', '--stdout'].includes(args[1]))) {
        throw Error('source-prepare-root-and-mode-required');
      }

      const { NestFactory: nestFactory } = await import('@nestjs/core');
      const { SourcePreparationModule: sourcePreparationModule } =
        await import('../modules/source-preparation/sourcePreparation.module.js');
      const { SourcePreparationService: sourcePreparationService } =
        await import('../modules/source-preparation/sourcePreparation.service.js');
      const { WizardSourceService: wizardSourceService } =
        await import('../modules/source-preparation/wizardSource.service.js');
      const app = await nestFactory.createApplicationContext(sourcePreparationModule, {
        logger: false,
      });
      try {
        const source = app.get(wizardSourceService);

        if (args[1] === '--verify') {
          source.validate(
            JSON.parse(
              fs.readFileSync(path.join(root, 'assets/wizard-source/snapshot.json'), 'utf8'),
            ),
          );
        } else if (args[1] === '--stdout') {
          console.log(JSON.stringify(source.pack(root)));
        } else {
          app.get(sourcePreparationService).prepare(root);
        }
      } finally {
        await app.close();
      }
      return true;
    }
    case 'wizard-source-publish': {
      if (args.length > 1) {
        throw Error('wizard-source-publication-mode-required');
      }

      const { wizardSourceMain } = await import('../modules/mirror/wizardSourceEntry.js');
      const result = await wizardSourceMain(args[0]);
      console.log(typeof result === 'string' ? result : 'Wizard source publication verified.');
      return true;
    }
    case 'github-backup': {
      if (args.length !== 1 || !['publish', 'ci', 'wizard-ci'].includes(args[0])) {
        throw Error('github-backup-mode-required');
      }

      const { main } = await import('../modules/mirror/entry.js');
      const controller = new AbortController();
      const cancel = () => controller.abort();
      const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
      for (const signal of signals) {
        process.on(signal, cancel);
      }
      try {
        console.log(
          await main(args[0], {
            cwd: process.cwd(),
            env: process.env,
            signal: controller.signal,
          }),
        );
      } finally {
        for (const signal of signals) {
          process.off(signal, cancel);
        }
      }
      return true;
    }
    case 'wizard-image-recovery': {
      if (args.length !== 1 || !path.isAbsolute(args[0])) {
        throw Error('absolute-checkout-required');
      }

      const { main } = await import('../modules/wizard-recovery/entry.js');
      await main(args[0]);
      return true;
    }
    case 'release': {
      if (args.length !== 1) {
        throw Error('release-action-required');
      }

      const { releaseMain } = await import('../modules/release/releaseEntry.js');
      await releaseMain(args[0]);
      console.log('Accepted release operation completed.');
      return true;
    }
    case 'renovate': {
      if (args[0] === 'setup') {
        const { main } = await import('../modules/renovate/setupEntry.js');
        await main(args.slice(1));
      } else if (args[0] === 'verify') {
        const { main } = await import('../modules/renovate/verifyEntry.js');
        await main(args.slice(1));
      } else {
        throw Error('renovate-setup-or-verify-required');
      }

      return true;
    }
    case 'ci': {
      const { ciMain } = await import('../modules/ci/entry.js');
      await ciMain(args);
      return true;
    }
    case 'docs': {
      const { documentationMain } = await import('../modules/documentation/authoringEntry.js');
      await documentationMain(args);
      return true;
    }
    case 'resources': {
      const { main } = await import('../modules/resources/entry.js');
      await main(args);
      return true;
    }
    default:
      return false;
  }
}
