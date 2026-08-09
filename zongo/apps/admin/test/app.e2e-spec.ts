import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminModule } from './../src/admin.module';
import { Server } from 'node:http';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

describe('AdminController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AdminModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    const openApi = new DocumentBuilder()
      .setTitle('Zongo Admin v1 API')
      .setVersion('1.0')
      .addCookieAuth('zongo_admin_session', { type: 'apiKey', in: 'cookie' })
      .build();
    SwaggerModule.setup(
      'admin/v1/openapi',
      app,
      SwaggerModule.createDocument(app, openApi),
    );
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('/admin (GET)', () => {
    const httpServer: Server = app.getHttpServer() as Server;

    return request(httpServer)
      .get('/admin')
      .expect(200)
      .expect({ service: 'zongo-admin', selfHosted: true, mfaRequired: true });
  });

  it('publishes the canonical OpenAPI contract and rejects bearer browser access', async () => {
    const httpServer: Server = app.getHttpServer() as Server;

    await request(httpServer)
      .get('/admin/v1/openapi-json')
      .expect(200)
      .expect((response) => {
        const body = response.body as unknown as {
          paths: Record<string, unknown>;
        };
        expect(body.paths['/admin/v1/auth/login']).toBeDefined();
        expect(
          body.paths['/admin/v1/auth/webauthn/login/verify'],
        ).toBeDefined();
      });

    await request(httpServer)
      .get('/admin/v1/auth/session')
      .set('Authorization', 'Bearer legacy-token')
      .expect(401);
  });

  it('requires the browser session for canonical WebAuthn registration', () => {
    const httpServer: Server = app.getHttpServer() as Server;

    return request(httpServer)
      .post('/admin/v1/auth/webauthn/registration/options')
      .send({})
      .expect(401);
  });
});
