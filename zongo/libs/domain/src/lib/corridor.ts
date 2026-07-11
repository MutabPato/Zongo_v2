export type CorridorCode =
  | 'DRC-KE'
  | 'KE-DRC'
  | 'DRC-UG'
  | 'UG-DRC'
  | 'KE-UG'
  | 'UG-KE';

export interface Corridor {
  readonly id: string;
  readonly code: CorridorCode;
  readonly displayName: string;
  readonly active: boolean;
}
