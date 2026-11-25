import { Inject, Injectable } from '@nestjs/common';
import { environmentPreflight, EnvironmentPreflightPort } from './ports';
import { EnvironmentStoreService } from './environmentStore.service';
import { environmentKinds, EnvironmentSettings, PlatformSettings } from './types';

@Injectable()
export class EnvironmentPreflightService {
  constructor(
    @Inject(environmentPreflight) private readonly external: EnvironmentPreflightPort,
    private readonly store: EnvironmentStoreService,
  ) {}

  async verify(settings: EnvironmentSettings, platform: PlatformSettings): Promise<void> {
    let expected: string[] = [];

    if (environmentKinds.some((name) => settings[name].enabled)) {
      try {
        expected = await this.external.resolve(platform.WIZARD_HOST || '');
      } catch {
        throw new Error(
          'Verify public DNS for the existing Production Wizard host before enabling environments.',
        );
      }

      if (!expected.length) {
        throw new Error('The existing Production Wizard host has no public DNS addresses.');
      }
    }

    for (const name of environmentKinds) {
      const value = settings[name];

      if (!value.enabled) {
        continue;
      }

      try {
        const addresses = await this.external.resolve(value.host);

        if (!addresses.length || addresses.some((address) => !expected.includes(address))) {
          throw new Error('DNS does not resolve exclusively to the configured Bootstrapper IP.');
        }

        await this.external.certificate(value.host, value.ssl, value.sslKey);
      } catch {
        throw new Error(
          'Validate DNS and the exact-host HTTPS certificate/key for ' +
            name +
            ' before activation.',
        );
      }
    }
  }

  async validateSettings(input: unknown): Promise<EnvironmentSettings> {
    const platform = this.store.platform();
    const settings = this.store.settings(input, platform);
    await this.verify(settings, platform);
    return settings;
  }
}
