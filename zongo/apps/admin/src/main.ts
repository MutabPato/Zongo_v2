import { NestFactory } from '@nestjs/core';
import { AdminModule } from './admin.module';
import { StructuredRequestLoggingInterceptor } from '@app/observability';

async function bootstrap() {
  const app = await NestFactory.create(AdminModule);
  app.useGlobalInterceptors(new StructuredRequestLoggingInterceptor());
  const bootstrap = await import('./adminjs-bootstrap.js');
  await bootstrap.mountAdminJs(app);
  await app.listen(Number(process.env.PORT ?? 3002), '0.0.0.0');
}
void bootstrap();
