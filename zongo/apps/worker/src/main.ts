import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });
  await app.listen(3001, '0.0.0.0');
}
void bootstrap();
