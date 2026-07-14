import { Test, TestingModule } from '@nestjs/testing';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

describe('AdminController', () => {
  let adminController: AdminController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [{ provide: AdminService, useValue: {} }],
    }).compile();

    adminController = app.get<AdminController>(AdminController);
  });

  describe('control plane', () => {
    it('declares the self-hosted MFA requirement', () => {
      expect(adminController.getControlPlane()).toEqual({
        service: 'zongo-admin',
        selfHosted: true,
        mfaRequired: true,
      });
    });
  });
});
