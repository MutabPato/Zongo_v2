import { ArgumentsHost, UnauthorizedException } from '@nestjs/common';
import { AdminV1ExceptionFilter } from './admin-v1-exception.filter';

describe('AdminV1ExceptionFilter', () => {
  it('returns a safe error envelope with the request correlation id', () => {
    const json = jest.fn();
    const response = {
      getHeader: jest.fn().mockReturnValue('trace-1'),
      status: jest.fn().mockReturnValue({ json }),
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ path: '/admin/v1/overview' }),
        getResponse: () => response,
      }),
    } as unknown as ArgumentsHost;

    new AdminV1ExceptionFilter().catch(
      new UnauthorizedException('session expired'),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      code: 'ADMIN_401',
      message: 'session expired',
      correlationId: 'trace-1',
      path: '/admin/v1/overview',
    });
  });
});
