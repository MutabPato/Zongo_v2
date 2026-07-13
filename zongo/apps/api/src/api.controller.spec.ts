import { Test, TestingModule } from '@nestjs/testing';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { WhatsappTransferService } from '@app/whatsapp';

describe('ApiController', () => {
  let apiController: ApiController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [ApiController],
      providers: [
        ApiService,
        {
          provide: WhatsappTransferService,
          useValue: { verifyMetaSignature: jest.fn() },
        },
      ],
    }).compile();

    apiController = app.get<ApiController>(ApiController);
  });

  describe('root', () => {
    it('should return health metadata', () => {
      expect(apiController.health()).toEqual({
        status: 'ok',
        service: 'api',
      });
    });
  });
});
