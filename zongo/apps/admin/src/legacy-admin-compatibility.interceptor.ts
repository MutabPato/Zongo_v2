import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';

/** Makes the temporary bearer compatibility surface observable without logging credentials or query data. */
@Injectable()
export class LegacyAdminCompatibilityInterceptor implements NestInterceptor {
  private readonly logger = new Logger('admin.legacy-compatibility');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<{ method?: string; route?: { path?: string } }>();
    const response = context
      .switchToHttp()
      .getResponse<{ setHeader?: (name: string, value: string) => void }>();
    const route = request.route?.path ?? 'unknown';
    response.setHeader?.('Deprecation', 'true');
    response.setHeader?.(
      'Sunset',
      process.env.ADMIN_LEGACY_REMOVAL_REVIEW_DATE ??
        'Wed, 31 Dec 2026 00:00:00 GMT',
    );
    response.setHeader?.('X-Admin-Compatibility', 'legacy-bearer-named-client');
    this.logger.warn(
      JSON.stringify({
        event: 'admin.legacy-route.used',
        method: request.method,
        route,
        owner: 'admin-platform',
        removalReviewDate:
          process.env.ADMIN_LEGACY_REMOVAL_REVIEW_DATE ?? '2026-12-31',
      }),
    );
    return next.handle();
  }
}
