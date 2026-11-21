import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { diagnosticTargets } from './system-diagnostics';
import { nativeProbe } from './connection-diagnostics.adapter';
import { inspectRunner, pullHelper } from './docker-diagnostics.adapter';
import { DiagnosticsController } from './diagnostics.controller';
import { DIAGNOSTIC_DEPENDENCIES, DiagnosticsService } from './diagnostics.service';

@Module({
  imports: [AuthModule],
  controllers: [DiagnosticsController],
  providers: [
    DiagnosticsService,
    {
      provide: DIAGNOSTIC_DEPENDENCIES,
      useFactory: () => ({
        targets: diagnosticTargets,
        probe: nativeProbe,
        inspect: inspectRunner,
        pull: pullHelper,
      }),
    },
  ],
})
export class DiagnosticsModule {}
