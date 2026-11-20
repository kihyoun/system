import {Module} from '@nestjs/common';
import {AuthModule} from './auth/auth.module';
import {ConfigurationModule} from './configuration/configuration.module';
import {ProjectsModule} from './projects/projects.module';
import {OperationsModule} from './operations/operations.module';
import {DiagnosticsModule} from './diagnostics/diagnostics.module';
import {RuntimeModule} from './runtime/runtime.module';

@Module({imports: [RuntimeModule, AuthModule, ConfigurationModule, ProjectsModule, OperationsModule, DiagnosticsModule]})
export class AppModule {}
