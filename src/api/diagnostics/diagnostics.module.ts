import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { diagnosticTargets } from './systemDiagnostics';
import { nativeProbe } from './connectionDiagnostics.adapter';
import { inspectRunner, pullHelper } from './dockerDiagnostics.adapter';
import { DiagnosticsController } from './diagnostics.controller';
import { diagnosticDependencies, DiagnosticsService } from './diagnostics.service';

@Module({
  imports: [AuthModule],
  controllers: [DiagnosticsController],
  providers: [
    DiagnosticsService,
    {
      provide: diagnosticDependencies,
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
