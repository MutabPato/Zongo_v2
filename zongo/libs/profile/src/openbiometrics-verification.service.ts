import {
  OpenBiometricsClient,
  type OpenBiometricsImage,
} from './openbiometrics-client';
import {
  SenderProfileService,
  type TechnicalVerificationInput,
} from './sender-profile.service';

export type OpenBiometricsVerificationInput = Omit<
  TechnicalVerificationInput,
  'status' | 'evidence'
> & {
  idImage: OpenBiometricsImage;
  selfieImage: OpenBiometricsImage;
  livenessPreset: string;
};

/**
 * Maps OpenBiometrics technical checks into the existing human-review case.
 * Provider response bodies are deliberately not persisted or logged.
 */
export class OpenBiometricsVerificationService {
  constructor(
    private readonly client: OpenBiometricsClient,
    private readonly profiles: SenderProfileService,
  ) {}

  async verify(input: OpenBiometricsVerificationInput) {
    try {
      await Promise.all([
        this.client.scanDocument(input.idImage),
        this.client.verify(input.idImage, input.selfieImage),
        this.client.createLivenessSession(input.livenessPreset),
      ]);
      return this.profiles.recordTechnicalVerification({
        senderProfileId: input.senderProfileId,
        providerReference: input.providerReference,
        idempotencyKey: input.idempotencyKey,
        verifiedPhoneNumber: input.verifiedPhoneNumber,
        collectedByIdentityId: input.collectedByIdentityId,
        consentAt: input.consentAt,
        status: 'HUMAN_REVIEW',
        evidence: {
          provider: 'openbiometrics',
          document: 'technical-check-completed',
          face: 'technical-check-completed',
          liveness: 'technical-check-completed',
          humanReviewRequired: true,
        },
      });
    } catch {
      return this.profiles.recordTechnicalVerification({
        senderProfileId: input.senderProfileId,
        providerReference: input.providerReference,
        idempotencyKey: input.idempotencyKey,
        verifiedPhoneNumber: input.verifiedPhoneNumber,
        collectedByIdentityId: input.collectedByIdentityId,
        consentAt: input.consentAt,
        status: 'TECHNICAL_REVIEW',
        failureReason: 'OpenBiometrics technical verification failed',
        evidence: {
          provider: 'openbiometrics',
          humanReviewRequired: true,
        },
      });
    }
  }
}
