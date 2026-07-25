import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiService } from './api.service';

@ApiTags('Health')
@Controller()
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Get('/health')
  @ApiOperation({ summary: 'Get basic API health status' })
  @ApiOkResponse({
    description: 'The API process is healthy.',
    schema: {
      example: { status: 'ok', service: 'api' },
    },
  })
  health() {
    return {
      status: 'ok',
      service: 'api',
    };
  }
}
