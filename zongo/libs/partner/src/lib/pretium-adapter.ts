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

  status(input: { reference: string }): Promise<{
    status:
      | 'PENDING_COLLECTION'
      | 'COLLECTION_SUCCESS'
      | 'COLLECTION_FAILED'
      | 'PENDING_PAYOUT'
      | 'PAYOUT_SUCCESS'
      | 'PAYOUT_FAILED';
    partnerReference?: string;
  }>;
}

export const PRETIUM_CLIENT = Symbol('PRETIUM_CLIENT');

export const unavailablePretiumClient: PretiumClient = {
  collect: () => Promise.reject(new Error('Pretium client is not configured')),
  payout: () => Promise.reject(new Error('Pretium client is not configured')),
  status: () => Promise.reject(new Error('Pretium client is not configured')),
};
