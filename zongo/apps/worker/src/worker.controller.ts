import {
  Controller,
  Get,
  Headers,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { WorkerService } from './worker.service';
import { WorkerMetricsService } from './worker-metrics.service';

@Controller()
export class WorkerController {
  constructor(
    private readonly workerService: WorkerService,
    @Optional() private readonly metrics?: WorkerMetricsService,
  ) {}

  @Get()
  getHello(): string {
    return this.workerService.getHello();
  }

  @Get('metrics')
  metricsSnapshot(@Headers('x-metrics-token') token?: string) {
    if (!this.metrics) throw new Error('Worker metrics are not configured');
    const configuredToken = process.env.METRICS_READ_TOKEN;
    if (!configuredToken || !token) {
      throw new UnauthorizedException(
        'Worker metrics authentication is required',
      );
    }
    const expected = Buffer.from(configuredToken, 'utf8');
    const received = Buffer.from(token, 'utf8');
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('Invalid worker metrics token');
    }
    return this.metrics.snapshot();
  }
}
