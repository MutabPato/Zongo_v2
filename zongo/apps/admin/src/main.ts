import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AdminModule } from './admin.module';
import { StructuredRequestLoggingInterceptor } from '@app/observability';

async function bootstrap() {
  const app = await NestFactory.create(AdminModule);
  app.use(
    (
      request: { path?: string },
      response: { setHeader: (name: string, value: string) => void },
      next: () => void,
    ) => {
      if (request.path?.startsWith('/admin/v1'))
        response.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.useGlobalInterceptors(new StructuredRequestLoggingInterceptor());
  const openApi = new DocumentBuilder()
    .setTitle('Zongo Admin v1 API')
    .setDescription(
      'Explicit browser control-plane contract; bearer compatibility is legacy-only.',
    )
    .setVersion('1.0')
    .addCookieAuth('zongo_admin_session', { type: 'apiKey', in: 'cookie' })
    .build();
  SwaggerModule.setup(
    'admin/v1/openapi',
    app,
    SwaggerModule.createDocument(app, openApi),
  );
  const bootstrap = await import('./adminjs-bootstrap.js');
  await bootstrap.mountAdminJs(app);
  await app.listen(Number(process.env.PORT ?? 3002), '0.0.0.0');
}
void bootstrap();
