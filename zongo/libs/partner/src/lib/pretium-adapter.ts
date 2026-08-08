export interface PretiumClient {
  collect(input: {
    reference: string;
    amountMinor: string;
    currency: string;
    beneficiaryId: string;
    senderPhoneNumber?: string;
    mobileNetwork?: string;
    callbackUrl?: string;
  }): Promise<{ partnerReference: string }>;

  payout(input: {
    reference: string;
    amountMinor: string;
    currency: string;
    beneficiaryId: string;
    payoutPhoneNumber?: string;
    mobileNetwork?: string;
    payoutAccount?: Record<string, unknown>;
    callbackUrl?: string;
  }): Promise<{ partnerReference: string }>;

  status(input: {
    reference: string;
    phase?: 'COLLECTION' | 'PAYOUT';
  }): Promise<{
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

export class PretiumHttpError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly providerCode: string | number | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'PretiumHttpError';
  }
}

type PretiumEnvelope = {
  code?: number;
  message?: string;
  data?: Record<string, unknown>;
};

export class PretiumHttpClient implements PretiumClient {
  constructor(
    private readonly baseUrl: string,
    private readonly consumerKey: string,
    private readonly callbackUrl?: string,
    private readonly timeoutMs = 10_000,
  ) {}

  collect(input: Parameters<PretiumClient['collect']>[0]) {
    if (!input.senderPhoneNumber)
      return Promise.reject(
        new Error('Pretium collection phone is unavailable'),
      );
    return this.post(`/${input.currency.toLowerCase()}/collect`, {
      shortcode: input.senderPhoneNumber,
      amount: this.amount(input.amountMinor),
      mobile_network: input.mobileNetwork,
      callback_url: input.callbackUrl ?? this.callbackUrl,
    }).then((data) => ({ partnerReference: this.reference(data) }));
  }

  payout(input: Parameters<PretiumClient['payout']>[0]) {
    if (!input.payoutPhoneNumber)
      return Promise.reject(new Error('Pretium payout phone is unavailable'));
    const account = input.payoutAccount ?? {};
    return this.post(`/${input.currency.toLowerCase()}/disburse`, {
      shortcode: input.payoutPhoneNumber,
      amount: this.amount(input.amountMinor),
      type: account.type ?? 'MOBILE',
      account_number: account.accountNumber ?? account.account_number,
      mobile_network:
        input.mobileNetwork ?? account.mobileNetwork ?? account.mobile_network,
      callback_url: input.callbackUrl ?? this.callbackUrl,
    }).then((data) => ({ partnerReference: this.reference(data) }));
  }

  status(input: Parameters<PretiumClient['status']>[0]) {
    const phase = input.phase ?? 'COLLECTION';
    const currency = phase === 'PAYOUT' ? 'kes' : 'cdf';
    return this.post(`/${currency}/status`, {
      transaction_code: input.reference,
    }).then((data) => {
      const statusValue = data.status;
      const status =
        typeof statusValue === 'string' ? statusValue.toUpperCase() : '';
      if (
        status === 'COMPLETE' ||
        status === 'SUCCESS' ||
        status === 'SUCCEEDED'
      )
        return {
          status:
            phase === 'PAYOUT'
              ? ('PAYOUT_SUCCESS' as const)
              : ('COLLECTION_SUCCESS' as const),
          partnerReference: this.reference(data),
        };
      if (status === 'FAILED' || status === 'FAILURE' || status === 'REJECTED')
        return {
          status:
            phase === 'PAYOUT'
              ? ('PAYOUT_FAILED' as const)
              : ('COLLECTION_FAILED' as const),
          partnerReference: this.reference(data),
        };
      return {
        status:
          phase === 'PAYOUT'
            ? ('PENDING_PAYOUT' as const)
            : ('PENDING_COLLECTION' as const),
        partnerReference: this.reference(data),
      };
    });
  }

  private async post(path: string, body: Record<string, unknown>) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: {
        'x-api-key': this.consumerKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const envelope = (await response
      .json()
      .catch(() => ({}))) as PretiumEnvelope;
    if (!response.ok || (envelope.code !== undefined && envelope.code >= 400))
      throw new PretiumHttpError(
        response.status,
        envelope.code,
        envelope.message ?? 'Pretium request failed',
      );
    const data = envelope.data;
    if (!data)
      throw new PretiumHttpError(
        response.status,
        envelope.code,
        'Pretium response omitted data',
      );
    return data;
  }

  private amount(value: string): number {
    const amount = Number(value);
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new Error('Pretium amount is outside the exact numeric range');
    return amount;
  }

  private reference(data: Record<string, unknown>): string {
    const reference = data.transaction_code ?? data.transactionCode;
    if (typeof reference !== 'string' || !reference)
      throw new Error('Pretium response omitted transaction_code');
    return reference;
  }
}
