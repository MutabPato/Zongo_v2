import { OpenBiometricsVerificationService } from './openbiometrics-verification.service';

const input = {
  senderProfileId: 'profile-1',
  providerReference: 'ob-1',
  idempotencyKey: 'idem-1',
  verifiedPhoneNumber: '+243800000000',
  idImage: {
    bytes: new Uint8Array([1]),
    filename: 'id.jpg',
    contentType: 'image/jpeg',
  },
  selfieImage: {
    bytes: new Uint8Array([2]),
    filename: 'selfie.jpg',
    contentType: 'image/jpeg',
  },
  livenessPreset: 'full',
} as const;

describe('OpenBiometricsVerificationService', () => {
  it('records successful technical checks as human review, never approval', async () => {
    const client = {
      scanDocument: jest.fn().mockResolvedValue({ raw: 'secret' }),
      verify: jest.fn().mockResolvedValue({ is_match: true }),
      createLivenessSession: jest.fn().mockResolvedValue({ score: 0.99 }),
    };
    const recordTechnicalVerification = jest
      .fn()
      .mockResolvedValue({ status: 'HUMAN_REVIEW' });
    const service = new OpenBiometricsVerificationService(
      client as never,
      { recordTechnicalVerification } as never,
    );

    await expect(service.verify(input)).resolves.toEqual({
      status: 'HUMAN_REVIEW',
    });
    expect(recordTechnicalVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'HUMAN_REVIEW',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        evidence: expect.objectContaining({
          humanReviewRequired: true,
          document: 'technical-check-completed',
        }),
      }),
    );
    expect(recordTechnicalVerification).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'APPROVED' }),
    );
  });

  it('records a safe technical-review failure without provider payloads', async () => {
    const client = {
      scanDocument: jest.fn().mockRejectedValue(new Error('provider secret')),
      verify: jest.fn(),
      createLivenessSession: jest.fn(),
    };
    const recordTechnicalVerification = jest
      .fn()
      .mockResolvedValue({ status: 'TECHNICAL_REVIEW' });
    const service = new OpenBiometricsVerificationService(
      client as never,
      { recordTechnicalVerification } as never,
    );

    await expect(service.verify(input)).resolves.toEqual({
      status: 'TECHNICAL_REVIEW',
    });
    expect(recordTechnicalVerification).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'TECHNICAL_REVIEW',
        failureReason: 'OpenBiometrics technical verification failed',
        evidence: { provider: 'openbiometrics', humanReviewRequired: true },
      }),
    );
  });
});
