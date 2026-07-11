import type { CorridorCode } from './corridor';

export interface CorridorPolicy {
  readonly corridorCode: CorridorCode;
  readonly maxAmount: number;
  readonly supportsCollection: boolean;
  readonly supportsPayout: boolean;
  readonly requiresManualReview: boolean;
}
