import {Body, Controller, Headers, HttpCode, Post, UseGuards} from '@nestjs/common';
import {AuthService} from './auth.service';
import {JwtAuthGuard} from './jwt-auth.guard';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') @HttpCode(200)
  login(@Body() input: any) { return this.auth.login(input); }
  @Post('token') @HttpCode(200)
  refresh(@Body() input: any) { return this.auth.refresh(input); }
  @Post('logout') @HttpCode(200) @UseGuards(JwtAuthGuard)
  logout(@Headers('authorization') authorization: string) { return this.auth.logout(authorization); }
}
