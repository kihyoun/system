import fs from 'node:fs';
import path from 'node:path';

/** Thin command adapters. Every operation belongs to its shared feature module. */
export async function applicationCommand(command: string, args: string[]): Promise<boolean> {
  switch (command) {
    case 'api': {
      if (args.length) throw Error('unexpected-api-arguments');
      const { bootstrap } = await import('../api/bootstrap.js');
      await bootstrap();
      return true;
    }
    case 'default-wizard': {
      if (args.length) throw Error('unexpected-default-wizard-arguments');
      const { defaultWizardMain } = await import('../api/projects/default-wizard.js');
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
      const { main } = await import('../modules/storage/manifest-entry.js');
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
        await import('../modules/host/public-gitlab-prerequisite-helper-entry.js');
      await publicGitlabHelperMain(args);
      return true;
    }
    case 'public-settings': {
      const { publicSettingsMain } = await import('../modules/lifecycle/public-settings-entry.js');
      await publicSettingsMain(args);
      return true;
    }
    case 'record-source-installation': {
      const { recordSourceInstallationMain } =
        await import('../modules/lifecycle/source-installation-entry.js');
      await recordSourceInstallationMain(args);
      return true;
    }
    case 'project-environments': {
      const { parse } = await import('../modules/project-lifecycle/environment-runtime.js');
      const { environmentMain } = await import('../modules/project-lifecycle/environment-entry.js');
      console.log(JSON.stringify(await environmentMain(parse(args))));
      return true;
    }
    case 'helper-inventory-verify': {
      if (args.length !== 1) throw Error('helper-inventory-hash-required');
      const { verifyHelperTree } = await import('../modules/project-lifecycle/helper-inventory.js');
      process.stdout.write(verifyHelperTree(args[0]));
      return true;
    }
    case 'project-environments-canonical': {
      if (args.length) throw Error('canonical-input-uses-stdin');
      const { canonicalStdin } = await import('../modules/project-lifecycle/canonical-entry.js');
      canonicalStdin();
      return true;
    }
    case 'project-environments-cleanup': {
      if (args.length !== 1) throw Error('cleanup-operation-required');
      const { cleanupStopped } = await import('../modules/project-lifecycle/environment-entry.js');
      console.log(JSON.stringify(await cleanupStopped(args[0])));
      return true;
    }
    case 'preview-setup': {
      const { main } = await import('../modules/project-lifecycle/preview-operator-entry.js');
      console.log(JSON.stringify(await main(args)));
      return true;
    }
    case 'system-beta': {
      const entry = await import('../modules/project-lifecycle/system-beta-entry.js');
      if (args[0] === 'bind') console.log(JSON.stringify(await entry.main(args.slice(1))));
      else if (args[0] === 'run' && args.length === 2) {
        const { writeEnvironment } =
          await import('../modules/project-lifecycle/system-beta-session.js');
        writeEnvironment(await entry.run(args[1]));
      } else throw Error('system-beta-bind-or-run-required');
      return true;
    }
    case 'system-review': {
      if (args.length !== 1 || args[0] !== 'stop') throw Error('legacy-system-review-stop-only');
      const { stopReview } = await import('../modules/project-lifecycle/system-beta-entry.js');
      await stopReview('stop');
      return true;
    }
    case 'wizard-production': {
      const { productionMain } = await import('../modules/project-lifecycle/production-entry.js');
      console.log(JSON.stringify(await productionMain(args)));
      return true;
    }
    case 'wizard-source-primary': {
      const { main } = await import('../modules/project-lifecycle/adoption-entry.js');
      console.log(JSON.stringify(await main(args)));
      return true;
    }
    case 'wizard-upgrade': {
      const { upgradeMain } = await import('../modules/project-lifecycle/upgrade-entry.js');
      console.log(JSON.stringify(await upgradeMain(args)));
      return true;
    }
    case 'source-checkout': {
      if (args.length > 1) throw Error('source-checkout-one-root-required');
      const { wizardSourcePreparationMain } =
        await import('../modules/source-preparation/wizard-source-entry.js');
      await wizardSourcePreparationMain(process.env, args[0] || process.cwd());
      console.log('Wizard source checkout verified at the committed source layout.');
      return true;
    }
    case 'source-prepare': {
      const root = path.resolve(args[0] || process.cwd());
      if (args.length > 2 || (args[1] && !['--verify', '--stdout'].includes(args[1])))
        throw Error('source-prepare-root-and-mode-required');
      const { NestFactory } = await import('@nestjs/core');
      const { SourcePreparationModule } =
        await import('../modules/source-preparation/source-preparation.module.js');
      const { SourcePreparationService } =
        await import('../modules/source-preparation/source-preparation.service.js');
      const { WizardSourceService } =
        await import('../modules/source-preparation/wizard-source.service.js');
      const app = await NestFactory.createApplicationContext(SourcePreparationModule, {
        logger: false,
      });
      try {
        const source = app.get(WizardSourceService);
        if (args[1] === '--verify') {
          source.validate(
            JSON.parse(
              fs.readFileSync(path.join(root, 'assets/wizard-source/snapshot.json'), 'utf8'),
            ),
          );
        } else if (args[1] === '--stdout') console.log(JSON.stringify(source.pack(root)));
        else app.get(SourcePreparationService).prepare(root);
      } finally {
        await app.close();
      }
      return true;
    }
    case 'wizard-source-publish': {
      if (args.length > 1) throw Error('wizard-source-publication-mode-required');
      const { wizardSourceMain } = await import('../modules/mirror/wizard-source-entry.js');
      const result = await wizardSourceMain(args[0]);
      console.log(typeof result === 'string' ? result : 'Wizard source publication verified.');
      return true;
    }
    case 'github-backup': {
      if (args.length !== 1 || !['publish', 'ci', 'wizard-ci'].includes(args[0]))
        throw Error('github-backup-mode-required');
      const { main } = await import('../modules/mirror/entry.js');
      const controller = new AbortController();
      const cancel = () => controller.abort();
      const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
      for (const signal of signals) process.on(signal, cancel);
      try {
        console.log(
          await main(args[0], {
            cwd: process.cwd(),
            env: process.env,
            signal: controller.signal,
          }),
        );
      } finally {
        for (const signal of signals) process.off(signal, cancel);
      }
      return true;
    }
    case 'wizard-image-recovery': {
      if (args.length !== 1 || !path.isAbsolute(args[0])) throw Error('absolute-checkout-required');
      const { main } = await import('../modules/wizard-recovery/entry.js');
      await main(args[0]);
      return true;
    }
    case 'release': {
      if (args.length !== 1) throw Error('release-action-required');
      const { releaseMain } = await import('../modules/release/release-entry.js');
      await releaseMain(args[0]);
      console.log('Accepted release operation completed.');
      return true;
    }
    case 'renovate': {
      if (args[0] === 'setup') {
        const { main } = await import('../modules/renovate/setup-entry.js');
        await main(args.slice(1));
      } else if (args[0] === 'verify') {
        const { main } = await import('../modules/renovate/verify-entry.js');
        await main(args.slice(1));
      } else throw Error('renovate-setup-or-verify-required');
      return true;
    }
    case 'ci': {
      const { ciMain } = await import('../modules/ci/entry.js');
      await ciMain(args);
      return true;
    }
    case 'docs': {
      const { documentationMain } = await import('../modules/documentation/authoring-entry.js');
      await documentationMain(args);
      return true;
    }
    case 'resources': {
      const { main } = await import('../modules/resources/entry.js');
      await main(args);
      return true;
    }
    case 'bundle-project-ci': {
      if (args.length > 1 || (args[0] && args[0] !== '--check'))
        throw Error('bundle-project-ci-check-only-option');
      const { bundleProjectCiMain } = await import('../modules/build/bundle-project-ci-entry.js');
      await bundleProjectCiMain(process.cwd(), args[0] === '--check');
      return true;
    }
    default:
      return false;
  }
}
