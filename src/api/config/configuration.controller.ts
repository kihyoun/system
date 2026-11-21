import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RuntimeService } from '../runtime/runtime.service';
import { ConfigurationService } from './configuration.service';

@Controller('config')
@UseGuards(JwtAuthGuard)
export class ConfigurationController {
  constructor(
    private readonly config: ConfigurationService,
    private readonly runtime: RuntimeService,
  ) {}

  @Get('main')
  @Header('Cache-Control', 'no-store')
  main() {
    return this.config.main();
  }

  @Get('suggestions')
  @Header('Cache-Control', 'no-store')
  suggestions(@Req() request: Request) {
    return this.config.suggestions(request.hostname);
  }

  @Get('projects')
  projects() {
    return this.config.projects();
  }

  @Post('project')
  @HttpCode(200)
  writeProject(@Body() input: any) {
    return this.config.writeProject(input);
  }

  @Post('impact')
  @HttpCode(200)
  impact(@Req() request: Request) {
    return this.config.impact(request.files);
  }

  @Post('zip')
  pushZip(@Req() request: Request, @Res() response: Response) {
    const result = this.config.pushZip(request.files, request.body);
    if (result.applyMode === 'restart') this.runtime.restartAfterResponse(response);
    response.status(200).json(result);
  }

  @Post('main')
  @HttpCode(200)
  writeMain(@Req() request: Request) {
    return this.config.writeMain(request.files);
  }

  @Delete('projects')
  deleteProjects() {
    return this.config.deleteProjects();
  }

  @Delete('main')
  deleteMain() {
    return this.config.deleteMain();
  }
}
