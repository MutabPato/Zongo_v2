import { NestFactory } from '@nestjs/core';
import { ApiModule } from './api.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { StructuredRequestLoggingInterceptor } from '@app/observability';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    ApiModule,
    new FastifyAdapter(),
    { rawBody: true },
  );
  const config = new DocumentBuilder()
    .setTitle('Zongo Public API')
    .setDescription(
      'Public HTTP endpoints for the Zongo money-transfer platform.',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  app.useGlobalInterceptors(new StructuredRequestLoggingInterceptor());
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
