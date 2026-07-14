import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { TransactionStatus } from '@prisma/client';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  getControlPlane() {
    return { service: 'zongo-admin', selfHosted: true, mfaRequired: true };
  }

  @Post('auth/login')
  login(@Body() body: { userId: string; totpCode: string }) {
    return this.adminService.login(body.userId, body.totpCode);
  }

  @Post('auth/break-glass')
  breakGlass(@Body() body: { userId: string; emergencySecret: string }) {
    return this.adminService.useBreakGlass(body.userId, body.emergencySecret);
  }

  @Get('transactions/:reference')
  async searchTransaction(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
  ): Promise<unknown> {
    const actor = await this.actor(authorization);
    return this.adminService.searchTransaction(actor.id, reference);
  }

  @Get('dashboard')
  async dashboard(
    @Headers('authorization') authorization: string | undefined,
  ): Promise<unknown> {
    const actor = await this.actor(authorization);
    return this.adminService.dashboard(actor.id);
  }

  @Get('operations/search')
  async searchOperations(
    @Headers('authorization') authorization: string | undefined,
    @Query('q') q?: string,
    @Query('status') status?: TransactionStatus,
    @Query('page') page?: string,
  ): Promise<unknown> {
    const actor = await this.actor(authorization);
    return this.adminService.searchOperations(actor.id, {
      q,
      status,
      page: page ? Number(page) : undefined,
    });
  }

  @Get('transactions/:reference/investigation')
  async investigateTransfer(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
  ): Promise<unknown> {
    const actor = await this.actor(authorization);
    return this.adminService.investigateTransfer(actor.id, reference);
  }

  @Post('transactions/:reference/notes')
  async addTransactionNote(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
    @Body() body: { body: string },
  ): Promise<unknown> {
    const actor = await this.actor(authorization);
    return this.adminService.addTransactionNote(actor.id, reference, body.body);
  }

  @Post('reconciliations/:reconciliationId/notes')
  async addReconciliationNote(
    @Headers('authorization') authorization: string | undefined,
    @Param('reconciliationId') reconciliationId: string,
    @Body() body: { body: string },
  ): Promise<unknown> {
    const actor = await this.actor(authorization);
    return this.adminService.addReconciliationNote(
      actor.id,
      reconciliationId,
      body.body,
    );
  }

  @Post('transactions/:reference/status-recheck')
  async recheckStatus(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.recheckStatus(actor.id, reference);
  }

  @Post('transactions/:reference/retry-payout')
  async retryPayout(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
    @Body() body: { correctedBeneficiaryId?: string },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.retryFailedPayout(
      actor.id,
      reference,
      body.correctedBeneficiaryId,
    );
  }

  @Get('beneficiaries')
  async reviewBeneficiaries(
    @Headers('authorization') authorization: string | undefined,
    @Query('search') search?: string,
    @Query('corridorId') corridorId?: string,
    @Query('userId') userId?: string,
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.reviewBeneficiaries(actor.id, {
      search,
      corridorId,
      userId,
    });
  }

  @Post('users/:userId/block')
  async blockUser(
    @Headers('authorization') authorization: string | undefined,
    @Param('userId') userId: string,
    @Body() body: { reason?: string },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.setUserBlocked(
      actor.id,
      userId,
      true,
      body.reason,
    );
  }

  @Post('users/:userId/unblock')
  async unblockUser(
    @Headers('authorization') authorization: string | undefined,
    @Param('userId') userId: string,
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.setUserBlocked(actor.id, userId, false);
  }

  @Post('policies/tier-0-transfer-caps')
  async setTier0TransferCaps(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { perTransferLimitMinor: string; dailyLimitMinor: string },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.setTier0TransferCaps(
      actor.id,
      BigInt(body.perTransferLimitMinor),
      BigInt(body.dailyLimitMinor),
    );
  }

  private async actor(authorization: string | undefined) {
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token)
      throw new UnauthorizedException('Bearer admin session token is required');
    return this.adminService.actorFromSession(token);
  }
}
