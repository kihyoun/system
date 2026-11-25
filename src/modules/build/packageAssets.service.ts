import { createPublicPayload, verifyPublicPayload } from '../../common/publicPayload';
import fs from 'node:fs';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
/** Packages shared runtime assets; evidence policies compile with the application. */
@Injectable()
export class PackageAssetsService {
  package(root: string): void {
    if (!path.isAbsolute(root)) {
      throw Error('absolute-package-root-required');
    }

    fs.rmSync(path.join(root, 'assets/project-bootstrap/preview-setup'), {
      recursive: true,
      force: true,
    });
    fs.rmSync(path.join(root, 'assets/gitlab/guided-preview-evidence.js'), { force: true });
    fs.rmSync(path.join(root, 'assets/gitlab/guided-preview-evidence-v1.js'), { force: true });
    fs.rmSync(path.join(root, 'assets/gitlab/job-diagnostics.js'), { force: true });

    if (!fs.statSync(path.join(root, 'LICENSE')).isFile()) {
      throw Error('package-license-required');
    }

    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'assets/public-runtime.json'),
      JSON.stringify(createPublicPayload(root)) + '\n',
    );
    verifyPublicPayload(root);
  }
}
