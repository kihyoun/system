import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/** Carries the existing Sync response contract through Nest's exception boundary. */
export class SyncHttpError extends HttpException {
  constructor(
    status: number,
    readonly payload?: object | string,
    readonly plain = false,
  ) {
    super(payload || '', status);
  }
}

export const operationFailed = () =>
  new SyncHttpError(500, { message: 'The operation failed. Inspect the protected service logs.' });

@Catch()
export class SyncExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (response.headersSent) return;
    if (error instanceof SyncHttpError) {
      if (error.payload === undefined) response.sendStatus(error.getStatus());
      else if (error.plain) response.status(error.getStatus()).send(error.payload);
      else response.status(error.getStatus()).json(error.payload);
      return;
    }
    if (error instanceof NotFoundException) {
      const request = host.switchToHttp().getRequest<Request>();
      const location = request.path.replace(
        /[&<>"']/g,
        (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value],
      );
      response.setHeader('Content-Security-Policy', "default-src 'none'");
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response
        .status(404)
        .type('html')
        .send(
          `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>Cannot ${request.method} ${location}</pre>\n</body>\n</html>\n`,
        );
      return;
    }
    // Parser failures and uncaught handler errors previously used this response.
    response.status(400).json({ message: 'Invalid request.' });
  }
}
