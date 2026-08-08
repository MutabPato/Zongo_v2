/* eslint-disable @typescript-eslint/unbound-method */
import { UnauthorizedException } from '@nestjs/common';
import type { WorkerMetricsService } from './worker-metrics.service';
import { WorkerController } from './worker.controller';
import type { WorkerService } from './worker.service';

describe('WorkerController', () => {
  const worker = {
    getHello: jest.fn().mockReturnValue('Hello World!'),
  } as unknown as WorkerService;
  const metrics = {
    snapshot: jest.fn().mockResolvedValue({ transfers: { total: 0 } }),
  } as unknown as WorkerMetricsService;
  const controller = new WorkerController(worker, metrics);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.METRICS_READ_TOKEN = 'metrics-secret';
  });

  afterAll(() => {
    delete process.env.METRICS_READ_TOKEN;
  });

  it('fails closed when the internal metrics token is missing', () => {
    expect(() => controller.metricsSnapshot()).toThrow(UnauthorizedException);
    expect(metrics.snapshot).not.toHaveBeenCalled();
  });

  it('rejects an invalid token before reading operational data', () => {
    expect(() => controller.metricsSnapshot('wrong-token')).toThrow(
      UnauthorizedException,
    );
    expect(metrics.snapshot).not.toHaveBeenCalled();
  });

  it('returns aggregate metrics for the authenticated internal reader', async () => {
    await expect(controller.metricsSnapshot('metrics-secret')).resolves.toEqual(
      {
        transfers: { total: 0 },
      },
    );
    expect(metrics.snapshot).toHaveBeenCalledTimes(1);
  });
});
