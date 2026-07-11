export interface PartnerCollectionRequest {
  readonly reference: string;
  readonly amount: number;
  readonly currency: string;
  readonly beneficiaryId: string;
}

export interface PartnerPayoutRequest {
  readonly reference: string;
  readonly amount: number;
  readonly currency: string;
  readonly beneficiaryId: string;
}
export type PartnerResult =
  | {
      success: true;
      partnerReference: string;
    }
  | {
      success: false;
      errorCode: string;
      errorMessage: string;
    };

export interface PartnerPort {
  collect(request: PartnerCollectionRequest): Promise<PartnerResult>;
  payout(request: PartnerPayoutRequest): Promise<PartnerResult>;
}
