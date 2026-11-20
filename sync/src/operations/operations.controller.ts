import {Controller, Get, Header, HttpCode, Param, Patch, Post, Res, UseGuards} from '@nestjs/common';
import type {Response} from 'express';
import {JwtAuthGuard} from '../auth/jwt-auth.guard';
import {RuntimeService} from '../runtime/runtime.service';
import {OperationsService} from './operations.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService, private readonly runtime: RuntimeService) {}
  @Get('status')
  status() { return this.operations.status(); }
  @Get('operations/credentials') @Header('Cache-Control', 'no-store')
  credentials() { return this.operations.credentials(); }
  @Post('command/backup') @HttpCode(202) @Header('Cache-Control', 'no-store')
  backup() { return this.operations.backup(); }
  @Get('backup/:id') @Header('Cache-Control', 'no-store')
  backupStatus(@Param('id') id: string) { return this.operations.backupStatus(id); }
  @Get('backup/:id/download') @Header('Cache-Control', 'no-store')
  download(@Param('id') id: string, @Res() response: Response) {
    const result = this.operations.backupDownload(id);
    response.attachment('bootstrapper.zip').type('application/zip').send(result.bytes);
  }
  @Patch('command/system/patch')
  patch() { return this.operations.patch(); }
  @Patch('command/seed')
  seed(@Res() response: Response) {
    const result = this.operations.seed();
    this.runtime.restartAfterResponse(response);
    response.status(200).json(result);
  }
  @Patch('command/restart')
  restart(@Res() response: Response) {
    const result = this.operations.restart();
    this.runtime.restartAfterResponse(response);
    response.status(200).json(result);
  }
  @Patch('command/harvest')
  harvest() { return this.operations.harvest(); }
  @Patch('command/runners/register')
  registerRunners() { return this.operations.registerRunners(); }
  @Patch('command/runners/unregister')
  unregisterRunners() { return this.operations.unregisterRunners(); }
}
