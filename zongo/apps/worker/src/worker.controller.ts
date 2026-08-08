import { Controller, Get } from '@nestjs/common';
import { WorkerService } from './worker.service';
import { WorkerMetricsService } from './worker-metrics.service';

@Controller()
export class WorkerController {
  constructor(
    private readonly workerService: WorkerService,
    private readonly metrics: WorkerMetricsService,
  ) {}

  @Get()
  getHello(): string {
    return this.workerService.getHello();
  }

  @Get('metrics')
  metricsSnapshot() {
    return this.metrics.snapshot();
  }
}
