/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { PretiumPartnerAdapter } from './pretium-adapter.service';
import type { PretiumClient } from './pretium-adapter';

describe('PretiumPartnerAdapter', () => {
  it('maps collect success to the shared port', async () => {
    const collect = jest.fn().mockResolvedValue({ partnerReference: 'pt_123' });
    const payout = jest.fn();
    const client = { collect, payout } as unknown as PretiumClient;

    const adapter = new PretiumPartnerAdapter(client);

    await expect(
      adapter.collect({
        reference: 'tx_1',
        amountMinor: 100n,
        currency: 'USD',
        beneficiaryId: 'ben_1',
      }),
    ).resolves.toEqual({
      success: true,
      partnerReference: 'pt_123',
    });

    expect(collect).toHaveBeenCalledWith({
      reference: 'tx_1',
      amount: 100,
      currency: 'USD',
      beneficiaryId: 'ben_1',
    });
  });

  it('normalizes collect failures', async () => {
    const collect = jest.fn().mockRejectedValue(new Error('Gateway timeout'));
    const payout = jest.fn();
    const client = { collect, payout } as unknown as PretiumClient;

    const adapter = new PretiumPartnerAdapter(client);

    await expect(
      adapter.collect({
        reference: 'tx_1',
        amountMinor: 100n,
        currency: 'USD',
        beneficiaryId: 'ben_1',
      }),
    ).resolves.toEqual({
      success: false,
      error: expect.objectContaining({
        code: 'PARTNER_TEMPORARY_FAILURE',
        retryable: true,
      }),
    });
  });

  it('normalizes payout failures', async () => {
    const collect = jest.fn();
    const payout = jest.fn().mockRejectedValue('boom');
    const client = { collect, payout } as unknown as PretiumClient;

    const adapter = new PretiumPartnerAdapter(client);

    await expect(
      adapter.payout({
        reference: 'tx_2',
        amountMinor: 250n,
        currency: 'KES',
        beneficiaryId: 'ben_2',
      }),
    ).resolves.toEqual({
      success: false,
      error: expect.objectContaining({
        code: 'PARTNER_REQUEST_FAILED',
        retryable: false,
      }),
    });
  });
});
