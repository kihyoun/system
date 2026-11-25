import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { WizardEnvironmentsModule } from '../../modules/wizard-environments/wizardEnvironments.module';

@Module({
  imports: [AuthModule, RuntimeModule, WizardEnvironmentsModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
