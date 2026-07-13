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

  getTransferStatus(reference: string): Promise<'RESOLVED' | 'AMBIGUOUS'>;
}

export const PRETIUM_CLIENT = Symbol('PRETIUM_CLIENT');

export const unavailablePretiumClient: PretiumClient = {
  collect: () => Promise.reject(new Error('Pretium client is not configured')),
  payout: () => Promise.reject(new Error('Pretium client is not configured')),
  getTransferStatus: () =>
    Promise.reject(new Error('Pretium client is not configured')),
};
