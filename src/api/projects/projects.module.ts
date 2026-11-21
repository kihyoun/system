import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [AuthModule, RuntimeModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
})
export class ProjectsModule {}
