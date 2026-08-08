/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PretiumHttpClient } from './pretium-adapter';

describe('PretiumHttpClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('calls the documented CDF collection route with the consumer key', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          data: { transaction_code: 'pretium_collect_1' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new PretiumHttpClient(
      'https://api.example.test/',
      'consumer-key',
    );

    await expect(
      client.collect({
        reference: 'ZNG-1',
        amountMinor: '2500',
        currency: 'CDF',
        beneficiaryId: 'ben_1',
        senderPhoneNumber: '+243800000001',
        mobileNetwork: 'Airtel Money',
      }),
    ).resolves.toEqual({
      partnerReference: 'pretium_collect_1',
      status: 'PENDING_COLLECTION',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/cdf/collect', 'https://api.example.test/'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'consumer-key' }),
        body: JSON.stringify({
          shortcode: '+243800000001',
          amount: 2500,
          mobile_network: 'Airtel Money',
          reference: 'ZNG-1',
        }),
      }),
    );
  });

  it('maps KES provider status to the canonical payout lifecycle', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          data: { status: 'COMPLETE', transaction_code: 'pretium_payout_1' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new PretiumHttpClient(
      'https://api.example.test',
      'consumer-key',
    );

    await expect(
      client.status({ reference: 'pretium_payout_1', phase: 'PAYOUT' }),
    ).resolves.toEqual({
      status: 'PAYOUT_SUCCESS',
      partnerReference: 'pretium_payout_1',
    });
  });

  it('passes the client reference to wallet-funded disbursement', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          data: { status: 'PENDING', transaction_code: 'pretium_payout_2' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const client = new PretiumHttpClient(
      'https://api.example.test',
      'consumer-key',
    );

    await expect(
      client.payout({
        reference: 'ZNG-2',
        amountMinor: '1000',
        currency: 'KES',
        beneficiaryId: 'ben_2',
        payoutPhoneNumber: '+254700000000',
        mobileNetwork: 'Safaricom',
      }),
    ).resolves.toEqual({
      partnerReference: 'pretium_payout_2',
      status: 'PENDING_PAYOUT',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('/kes/disburse', 'https://api.example.test/'),
      expect.objectContaining({
        body: JSON.stringify({
          shortcode: '+254700000000',
          amount: 1000,
          type: 'MOBILE',
          mobile_network: 'Safaricom',
          reference: 'ZNG-2',
        }),
      }),
    );
  });

  it('rejects unsafe client configuration before making a request', () => {
    expect(
      () => new PretiumHttpClient('http://api.example.test', 'consumer-key'),
    ).toThrow('Pretium base URL must use HTTPS');
    expect(
      () =>
        new PretiumHttpClient('https://user:pass@example.test', 'consumer-key'),
    ).toThrow('Pretium base URL must not contain credentials');
    expect(
      () => new PretiumHttpClient('https://api.example.test', ' '),
    ).toThrow('Pretium consumer key is required');
    expect(
      () =>
        new PretiumHttpClient('https://api.example.test', 'key', undefined, 0),
    ).toThrow('Pretium timeout must be a positive integer');
  });
});
