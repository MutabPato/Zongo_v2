import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';
import { StructuredRequestLoggingInterceptor } from '@app/observability';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  app.useGlobalInterceptors(new StructuredRequestLoggingInterceptor());
  await app.listen(Number(process.env.PORT ?? 3001), '0.0.0.0');
}
void bootstrap();
