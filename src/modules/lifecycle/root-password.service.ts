import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type RootPasswordPreparation = 'retained' | 'existing-database' | 'created';

/** First-install credentials never reset an existing GitLab database. */
@Injectable()
export class RootPasswordService {
  prepare(configDirectory: string, dataDirectory: string, supplied = ''): RootPasswordPreparation {
    const target = path.join(configDirectory, 'bootstrapper_initial_root_password');
    if (fs.existsSync(target)) {
      fs.chmodSync(target, 0o600);
      return 'retained';
    }
    if (fs.existsSync(path.join(dataDirectory, 'postgresql'))) return 'existing-database';
    if (supplied && (supplied.length < 12 || /[\r\n\0]/.test(supplied)))
      throw Error('Initial root password needs at least 12 characters and no line breaks or NUL.');
    fs.mkdirSync(configDirectory, { recursive: true });
    fs.writeFileSync(target, supplied || crypto.randomBytes(24).toString('hex'), {
      mode: 0o600,
      flag: 'wx',
    });
    return 'created';
  }
}
