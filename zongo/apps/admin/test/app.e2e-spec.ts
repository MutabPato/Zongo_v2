import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdminModule } from './../src/admin.module';
import { Server } from 'node:http';

describe('AdminController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AdminModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/admin (GET)', () => {
    const httpServer: Server = app.getHttpServer() as Server;

    return request(httpServer)
      .get('/admin')
      .expect(200)
      .expect({ service: 'zongo-admin', selfHosted: true, mfaRequired: true });
  });
});
