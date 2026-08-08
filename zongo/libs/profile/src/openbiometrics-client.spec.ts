import {
  OpenBiometricsClient,
  OpenBiometricsRequestError,
  type OpenBiometricsImage,
} from './openbiometrics-client';

const image: OpenBiometricsImage = {
  bytes: new Uint8Array([1, 2, 3]),
  filename: 'selfie.jpg',
  contentType: 'image/jpeg',
};

describe('OpenBiometricsClient', () => {
  it('sends multipart verification requests with optional authentication', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ is_match: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new OpenBiometricsClient({
      baseUrl: 'http://localhost:8000',
      apiKey: 'poc-key',
      fetchImpl,
    });

    await expect(
      client.verify(image, { ...image, filename: 'id.jpg' }),
    ).resolves.toEqual({
      is_match: true,
    });
    const [, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe('POST');
    expect((init.headers as Headers).get('Authorization')).toBe(
      'Bearer poc-key',
    );
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('supports liveness sessions and rejects provider failures without payloads', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response('upstream failure', { status: 503 }));
    const client = new OpenBiometricsClient({
      baseUrl: 'http://localhost:8000/',
      fetchImpl,
    });

    await expect(client.createLivenessSession('full')).rejects.toEqual(
      expect.objectContaining<Partial<OpenBiometricsRequestError>>({
        status: 503,
        message: 'OpenBiometrics request failed with HTTP 503',
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('/api/v1/liveness/sessions?preset=full', 'http://localhost:8000'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects unsafe endpoint configuration and invalid presets', () => {
    expect(
      () =>
        new OpenBiometricsClient({ baseUrl: 'https://user:pass@example.test' }),
    ).toThrow('must not contain credentials');
    expect(() =>
      new OpenBiometricsClient({
        baseUrl: 'http://localhost:8000',
      }).createLivenessSession(' '),
    ).toThrow('A liveness preset is required');
  });
});
