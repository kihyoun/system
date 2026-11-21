import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import { rateLimit } from 'express-rate-limit';
import morgan from 'morgan';
import { allowedBrowserOrigin } from './security';
import { RuntimeService } from '../runtime/runtime.service';

/** Register before Nest initializes routes; ordering is part of the native API. */
export function installMiddleware(app: NestExpressApplication, runtime: RuntimeService) {
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 600,
      keyGenerator: () => 'sync',
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'Too many control requests. Retry shortly.' },
    }),
  );
  app.use(
    ['/login', '/token'],
    rateLimit({
      windowMs: 15 * 60000,
      limit: 20,
      keyGenerator: () => 'sync-auth',
      skipSuccessfulRequests: true,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { message: 'Too many failed authentication attempts. Retry later.' },
    }),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    try {
      if (!allowedBrowserOrigin(req)) {
        res
          .status(403)
          .json({ message: 'Browser origin is not configured for this Sync endpoint.' });
        return;
      }
      next();
    } catch {
      res.status(503).json({ message: 'Browser origin settings are unavailable.' });
    }
  });
  app.use(
    cors((req, callback) =>
      callback(null, {
        origin: req.headers.origin || false,
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
        allowedHeaders: ['Authorization', 'Content-Type'],
        preflightContinue: false,
        optionsSuccessStatus: 204,
      }),
    ),
  );
  app.use(bodyParser.json({ limit: '5mb' }));
  app.use(bodyParser.urlencoded({ extended: false, limit: '5mb' }));
  // Parse a second file so duplicate fields cannot silently become valid uploads.
  app.use(fileUpload({ limits: { fileSize: 50 * 1024 * 1024, files: 2 }, abortOnLimit: true }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const files = Object.values(req.files || {}).flat();
    if (files.length > 1) {
      res.status(400).json({ message: 'Upload exactly one file.' });
      return;
    }
    next();
  });
  app.use(morgan('combined'));
  app.use((req: Request, res: Response, next: NextFunction) => {
    const upgrading = runtime.upgradeBusy();
    // Local receipt polling stays available under guided setup's storage lease.
    const localProjectRead =
      req.method === 'GET' &&
      (req.path === '/projects/wizard/preview-setup' ||
        /^\/projects\/jobs\/[a-zA-Z0-9_-]{1,128}$/.test(req.path));
    if (
      (upgrading || runtime.storageOperationBusy()) &&
      (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
        (req.path.startsWith('/projects') && !localProjectRead)) &&
      !['/login', '/token', '/logout'].includes(req.path)
    ) {
      res.status(409).json({
        message: upgrading
          ? 'A GitLab upgrade is in progress. Wait before changing the platform.'
          : 'A backup or recovery operation is in progress. Wait before changing the platform.',
      });
      return;
    }
    next();
  });
  app.use(['/config', '/command'], (req: Request, res: Response, next: NextFunction) => {
    if (runtime.operationBusy() && req.method !== 'GET') {
      res.status(409).json({
        message:
          'A backup, recovery, runner or project operation is in progress. Wait before changing the configuration.',
      });
      return;
    }
    next();
  });
}
