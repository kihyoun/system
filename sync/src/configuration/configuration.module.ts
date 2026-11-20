import {Module} from '@nestjs/common';
import {AuthModule} from '../auth/auth.module';
import {RuntimeModule} from '../runtime/runtime.module';
import {ConfigurationController} from './configuration.controller';
import {ConfigurationService} from './configuration.service';

@Module({imports: [AuthModule, RuntimeModule], controllers: [ConfigurationController], providers: [ConfigurationService]})
export class ConfigurationModule {}
