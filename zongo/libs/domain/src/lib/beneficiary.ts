export interface beneficiary {
  readonly id: string;
  readonly userId: string;
  readonly fullName: string;
  readonly phoneNumber: string;
  readonly payoutCountryCode: string;
  readonly createdAt: Date;
}
