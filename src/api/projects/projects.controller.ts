import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwtAuth.guard';
import { ProjectsService } from './projects.service';

@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get('wizard/preview-setup')
  @Header('Cache-Control', 'no-store')
  previewSetup() {
    return this.projects.previewSetup();
  }

  @Post('wizard/preview-setup/preflight')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  preflight(@Body() input: unknown) {
    return this.projects.preflight(input);
  }

  @Post('wizard/preview-setup/apply')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  applyPreview(@Body() input: unknown) {
    return this.projects.applyPreview(input);
  }

  @Get('jobs/:id')
  @Header('Cache-Control', 'no-store')
  job(@Param('id') id: string) {
    return this.projects.job(id);
  }

  @Get('wizard/source')
  @Header('Cache-Control', 'no-store')
  source() {
    return this.projects.source();
  }

  @Post('wizard/source')
  @HttpCode(202)
  initializeSource(@Body() input: unknown) {
    return this.projects.initializeSource(input);
  }

  @Get('wizard/build')
  @Header('Cache-Control', 'no-store')
  build() {
    return this.projects.build();
  }

  @Post('wizard/build')
  @HttpCode(202)
  activateBuild(@Body() input: unknown) {
    return this.projects.activateBuild(input);
  }

  @Get('wizard/build/status')
  @Header('Cache-Control', 'no-store')
  buildStatus(@Res() response: Response) {
    const result = this.projects.buildStatus();
    response.status(result.state === 'not-activated' ? 200 : 202).json(result);
  }

  @Get('wizard/environments')
  @Header('Cache-Control', 'no-store')
  environments() {
    return this.projects.environments();
  }

  @Post('wizard/environments')
  @HttpCode(202)
  configureEnvironments(@Body() input: unknown) {
    return this.projects.configureEnvironments(input);
  }

  @Get('wizard/environments/status')
  @Header('Cache-Control', 'no-store')
  environmentStatus(@Res() response: Response) {
    const result = this.projects.environmentStatus();
    response.status(result.state === 'not-activated' ? 200 : 202).json(result);
  }

  @Get('namespaces')
  @HttpCode(202)
  namespaces() {
    return this.projects.namespaces();
  }

  @Get('availability')
  availability(
    @Query('projectKey') projectKey: unknown,
    @Query('namespaceId') namespaceId: unknown,
    @Res() response: Response,
  ) {
    const result = this.projects.availability(projectKey, namespaceId);
    response.status(result.occupied ? 200 : 202).json(result.result);
  }

  @Post()
  @HttpCode(202)
  create(@Body() input: unknown) {
    return this.projects.create(input);
  }
}
