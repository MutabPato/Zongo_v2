import { Controller, Get } from '@nestjs/common';
import { DatabaseHealthService } from '@app/db';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseHealthService) {}

  @Get('live')
  live() {
    return { status: 'ok', service: 'worker' };
  }

  @Get('ready')
  async ready() {
    await this.database.check();
    return { status: 'ok', service: 'worker' };
  }
}
