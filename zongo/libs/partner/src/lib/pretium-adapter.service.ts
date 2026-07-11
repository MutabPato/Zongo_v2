import {
  PartnerPort,
  PartnerCollectionRequest,
  PartnerPayoutRequest,
  PartnerResult,
} from './partner-port';
import { normalizePartnerError } from './partner-error';
import { PretiumClient } from './pretium-adapter';

export class PretiumPartnerAdapter implements PartnerPort {
  constructor(private readonly client: PretiumClient) {}

  async collect(request: PartnerCollectionRequest): Promise<PartnerResult> {
    try {
      const response = await this.client.collect(request);
      return {
        success: true,
        partnerReference: response.partnerReference,
      };
    } catch (error) {
      return this.fail(error);
    }
  }

  async payout(request: PartnerPayoutRequest): Promise<PartnerResult> {
    try {
      const response = await this.client.payout(request);
      return {
        success: true,
        partnerReference: response.partnerReference,
      };
    } catch (error) {
      return this.fail(error);
    }
  }

  private fail(error: unknown): PartnerResult {
    const message =
      error instanceof Error ? error.message : 'Unknown partner error';
    const normalized = normalizePartnerError('UNKNOWN', message);

    return {
      success: false,
      errorCode: normalized.code,
      errorMessage: normalized.message,
    };
  }
}
