import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class AdminV1ExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const raw =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      typeof raw === 'object' && raw !== null && 'message' in raw
        ? (raw as { message?: string | string[] }).message
        : typeof raw === 'string'
          ? raw
          : status >= 500
            ? 'Admin request failed'
            : 'Admin request was rejected';
    const correlationId = response.getHeader('x-request-id')?.toString();
    response.status(status).json({
      code: `ADMIN_${status}`,
      message: Array.isArray(message) ? message.join('; ') : message,
      ...(correlationId ? { correlationId } : {}),
      path: request.path,
    });
  }
}
