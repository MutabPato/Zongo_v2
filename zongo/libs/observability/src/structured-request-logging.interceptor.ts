import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { finalize } from 'rxjs';

type HeaderRequest = {
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
  route?: { path?: string };
};

type HeaderResponse = {
  statusCode?: number;
  setHeader?: (name: string, value: string) => void;
};

export function getOrCreateRequestTraceId(request: HeaderRequest): string {
  const header = request.headers?.['x-request-id'];
  const value = Array.isArray(header) ? header[0] : header;
  return value?.trim() || randomUUID();
}

/** Structured request telemetry; routes and timings only, never bodies or query values. */
@Injectable()
export class StructuredRequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http.request');

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<HeaderRequest>();
    const response = http.getResponse<HeaderResponse>();
    const traceId = getOrCreateRequestTraceId(request);
    const startedAt = Date.now();
    response.setHeader?.('x-request-id', traceId);

    return next.handle().pipe(
      finalize(() => {
        this.logger.log(
          JSON.stringify({
            event: 'http.request',
            traceId,
            method: request.method,
            route: request.route?.path ?? request.url?.split('?')[0],
            statusCode: response.statusCode,
            durationMs: Date.now() - startedAt,
          }),
        );
      }),
    );
  }
}
