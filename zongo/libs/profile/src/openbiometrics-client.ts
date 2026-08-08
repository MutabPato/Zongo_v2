export type OpenBiometricsImage = {
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  contentType: string;
};

export type OpenBiometricsClientOptions = {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class OpenBiometricsRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OpenBiometricsRequestError';
  }
}

/**
 * Transport-only client for a self-hosted OpenBiometrics instance.
 * Results must still be recorded as technical evidence and independently
 * reviewed through SenderProfileService before eligibility can change.
 */
export class OpenBiometricsClient {
  private readonly baseUrl: URL;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenBiometricsClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol))
      throw new Error('OpenBiometrics base URL must use HTTP or HTTPS');
    if (this.baseUrl.username || this.baseUrl.password)
      throw new Error('OpenBiometrics base URL must not contain credentials');
    this.apiKey = options.apiKey?.trim() || undefined;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0)
      throw new Error('OpenBiometrics timeout must be a positive integer');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  detect(image: OpenBiometricsImage): Promise<unknown> {
    return this.multipart('/api/v1/detect', { image });
  }

  verify(
    idImage: OpenBiometricsImage,
    selfieImage: OpenBiometricsImage,
  ): Promise<unknown> {
    return this.multipart('/api/v1/verify', {
      image1: idImage,
      image2: selfieImage,
    });
  }

  scanDocument(image: OpenBiometricsImage): Promise<unknown> {
    return this.multipart('/api/v1/documents/scan', { image });
  }

  createLivenessSession(preset: string): Promise<unknown> {
    const normalizedPreset = preset.trim();
    if (!normalizedPreset) throw new Error('A liveness preset is required');
    return this.request(
      `/api/v1/liveness/sessions?preset=${encodeURIComponent(normalizedPreset)}`,
      { method: 'POST' },
    );
  }

  private async multipart(
    path: string,
    images: Record<string, OpenBiometricsImage>,
  ): Promise<unknown> {
    const form = new FormData();
    for (const [field, image] of Object.entries(images)) {
      form.append(
        field,
        new Blob([image.bytes], { type: image.contentType }),
        image.filename,
      );
    }
    return this.request(path, { method: 'POST', body: form });
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    const headers = new Headers(init.headers);
    if (this.apiKey) headers.set('Authorization', `Bearer ${this.apiKey}`);
    const response = await this.fetchImpl(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok)
      throw new OpenBiometricsRequestError(
        response.status,
        `OpenBiometrics request failed with HTTP ${response.status}`,
      );
    try {
      return await response.json();
    } catch {
      throw new OpenBiometricsRequestError(
        response.status,
        'OpenBiometrics returned an invalid JSON response',
      );
    }
  }
}
