export type TransferStatus =
  | 'INITIATED'
  | 'PENDING_COLLECTION'
  | 'COLLECTION_SUCCESS'
  | 'COLLECTION_FAILED'
  | 'PENDING_PAYOUT'
  | 'PAYOUT_SUCCESS'
  | 'PAYOUT_FAILED';

export interface TransferTransaction {
  readonly id: string;
  readonly reference: string;
  readonly corridorId: string;
  readonly status: TransferStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
