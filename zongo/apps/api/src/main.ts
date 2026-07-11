import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    new FastifyAdapter(),
  );
  await app.listen(3000, '0.0.0.0');
}
void bootstrap();
