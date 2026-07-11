import {
  PartnerPort,
  PartnerCollectionRequest,
  PartnerPayoutRequest,
  PartnerResult,
} from './partner-port';
import { normalizePartnerError } from './partner-error';
import type { PretiumClient } from './pretium-adapter';
import { Inject, Injectable } from '@nestjs/common';
import { PRETIUM_CLIENT } from './pretium-adapter';

@Injectable()
export class PretiumPartnerAdapter implements PartnerPort {
  constructor(@Inject(PRETIUM_CLIENT) private readonly client: PretiumClient) {}

  async collect(request: PartnerCollectionRequest): Promise<PartnerResult> {
    try {
      const response = await this.client.collect({
        reference: request.reference,
        amount: Number(request.amountMinor),
        currency: request.currency,
        beneficiaryId: request.beneficiaryId,
      });
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
      const response = await this.client.payout({
        reference: request.reference,
        amount: Number(request.amountMinor),
        currency: request.currency,
        beneficiaryId: request.beneficiaryId,
      });
      return {
        success: true,
        partnerReference: response.partnerReference,
      };
    } catch (error) {
      return this.fail(error);
    }
  }

  private fail(error: unknown): PartnerResult {
    return {
      success: false,
      error: normalizePartnerError(error),
    };
  }
}
