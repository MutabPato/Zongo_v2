export interface PretiumClient {
  collect(input: {
    reference: string;
    amount: number;
    currency: string;
    beneficiaryId: string;
  }): Promise<{ partnerReference: string }>;

  payout(input: {
    reference: string;
    amount: number;
    currency: string;
    beneficiaryId: string;
  }): Promise<{ partnerReference: string }>;
}
