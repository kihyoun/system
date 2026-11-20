import {Injectable} from '@nestjs/common';
import jwt from 'jsonwebtoken';
import {randomBytes} from 'node:crypto';
import {SyncHttpError} from '../http/sync-http-error';

@Injectable()
export class AuthService {
  private readonly serverSecret = randomBytes(64).toString('base64url');
  private readonly serverTokenSecret = randomBytes(64).toString('base64url');
  private readonly username = process.env.SYNC_USER || randomBytes(32).toString('base64url');
  private readonly password = process.env.SYNC_PASS || randomBytes(32).toString('base64url');
  private refreshTokens: string[] = [];

  authenticate(authorization: string | undefined) {
    if (!authorization) throw new SyncHttpError(401);
    try { return jwt.verify(authorization.split(' ')[1], this.serverSecret); }
    catch { throw new SyncHttpError(403); }
  }
  login(input: any) {
    const {username, password} = input;
    if (username !== this.username || password !== this.password)
      throw new SyncHttpError(401, 'Username or Password incorrect', true);
    const accessToken = jwt.sign({username}, this.serverSecret, {expiresIn: '20m'});
    const refreshToken = jwt.sign({username}, this.serverTokenSecret);
    this.refreshTokens.push(refreshToken);
    return {accessToken, refreshToken};
  }
  refresh(input: any) {
    const {token} = input;
    if (!token) throw new SyncHttpError(401);
    if (!this.refreshTokens.includes(token)) throw new SyncHttpError(403);
    try {
      const user = jwt.verify(token, this.serverTokenSecret) as jwt.JwtPayload;
      return {accessToken: jwt.sign({username: user.username, role: user.role}, this.serverSecret, {expiresIn: '20m'})};
    } catch { throw new SyncHttpError(403); }
  }
  logout(authorization: string) {
    const token = authorization.split(' ')[1];
    this.refreshTokens = this.refreshTokens.filter(value => token !== value);
    return 'Logout successful';
  }
}
