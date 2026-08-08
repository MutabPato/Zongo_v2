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
    ).resolves.toEqual({ partnerReference: 'pretium_collect_1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/cdf/collect',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'consumer-key' }),
        body: JSON.stringify({
          shortcode: '+243800000001',
          amount: 2500,
          mobile_network: 'Airtel Money',
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
});
