import { Controller, Get, Optional } from '@nestjs/common';
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
  metricsSnapshot() {
    if (!this.metrics) throw new Error('Worker metrics are not configured');
    return this.metrics.snapshot();
  }
}
