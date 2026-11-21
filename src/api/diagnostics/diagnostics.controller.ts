import { Body, Controller, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DiagnosticsService } from './diagnostics.service';

@Controller('diagnostics')
@UseGuards(JwtAuthGuard)
export class DiagnosticsController {
  constructor(private readonly diagnostics: DiagnosticsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  targets() {
    return this.diagnostics.targets();
  }

  @Post('connection')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  connection(@Body() input: any) {
    return this.diagnostics.connection(input);
  }

  @Post('pull')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  pull(@Body() input: any) {
    return this.diagnostics.pull(input);
  }
}
