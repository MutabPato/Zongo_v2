import {
  PartnerPort,
  PartnerCollectionRequest,
  PartnerPayoutRequest,
  PartnerResult,
  PartnerStatusResult,
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
        amountMinor: request.amountMinor.toString(),
        currency: request.currency,
        beneficiaryId: request.beneficiaryId,
        senderPhoneNumber: request.senderPhoneNumber,
        mobileNetwork: request.mobileNetwork,
        callbackUrl: process.env.PRETIUM_WEBHOOK_URL,
      });
      return {
        success: true,
        partnerReference: response.partnerReference,
        status: response.status,
      };
    } catch (error) {
      return { success: false, error: normalizePartnerError(error) };
    }
  }

  async payout(request: PartnerPayoutRequest): Promise<PartnerResult> {
    try {
      const response = await this.client.payout({
        reference: request.reference,
        amountMinor: request.amountMinor.toString(),
        currency: request.currency,
        beneficiaryId: request.beneficiaryId,
        payoutPhoneNumber: request.payoutPhoneNumber,
        mobileNetwork: request.mobileNetwork,
        payoutAccount: request.payoutAccount,
        callbackUrl: process.env.PRETIUM_WEBHOOK_URL,
      });
      return {
        success: true,
        partnerReference: response.partnerReference,
        status: response.status,
      };
    } catch (error) {
      return this.fail(error);
    }
  }

  async status(
    reference: string,
    phase?: 'COLLECTION' | 'PAYOUT',
  ): Promise<PartnerStatusResult> {
    try {
      const response = await this.client.status({ reference, phase });
      return {
        success: true,
        status: response.status,
        partnerReference: response.partnerReference,
      };
    } catch (error) {
      return { success: false, error: normalizePartnerError(error) };
    }
  }

  private fail(error: unknown): PartnerResult {
    return {
      success: false,
      error: normalizePartnerError(error),
    };
  }
}
