import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DatabaseHealthService } from '@app/db';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseHealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Check whether the API process is running' })
  @ApiOkResponse({
    description: 'The API process is live.',
    schema: { example: { status: 'ok', service: 'api' } },
  })
  live() {
    return { status: 'ok', service: 'api' };
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Check whether the API is ready to receive traffic',
  })
  @ApiOkResponse({
    description: 'The API is connected to its required database dependency.',
    schema: { example: { status: 'ok', service: 'api' } },
  })
  @ApiServiceUnavailableResponse({
    description: 'The database dependency is unavailable.',
  })
  async ready() {
    await this.database.check();
    return { status: 'ok', service: 'api' };
  }
}
