import { getOrCreateRequestTraceId } from './structured-request-logging.interceptor';

describe('structured request telemetry', () => {
  it('propagates a caller-provided request id', () => {
    expect(
      getOrCreateRequestTraceId({ headers: { 'x-request-id': 'trace-123' } }),
    ).toBe('trace-123');
  });

  it('creates a request id when the caller did not provide one', () => {
    expect(getOrCreateRequestTraceId({})).toMatch(/^[0-9a-f-]{36}$/);
  });
});
