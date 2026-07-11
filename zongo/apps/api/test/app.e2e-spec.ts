import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ApiModule } from './../src/api.module';
import type { Server } from 'node:http';

describe('ApiController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ApiModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    const httpServer: Server = app.getHttpServer() as Server;

    return request(httpServer).get('/health').expect(200).expect({
      status: 'ok',
      service: 'api',
    });
  });
});
