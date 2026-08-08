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
import { WebAuthnService } from './webauthn.service';
import { TransactionStatus } from '@prisma/client';
import { PilotControlKey, PilotControlState } from '@prisma/client';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly webauthn: WebAuthnService,
  ) {}

  @Get()
  getControlPlane() {
    return { service: 'zongo-admin', selfHosted: true, mfaRequired: true };
  }

  @Post('auth/login')
  login(@Body() body: { userId: string; totpCode: string }) {
    return this.adminService.login(body.userId, body.totpCode);
  }

  @Post('auth/hardware-key/register/options')
  async hardwareKeyRegistrationOptions(
    @Headers('authorization') authorization: string | undefined,
  ) {
    const actor = await this.actor(authorization);
    return this.webauthn.registrationOptions(actor.id);
  }

  @Post('auth/hardware-key/register/verify')
  async verifyHardwareKeyRegistration(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: { response: Parameters<WebAuthnService['verifyRegistration']>[1] },
  ) {
    const actor = await this.actor(authorization);
    return this.webauthn.verifyRegistration(actor.id, body.response);
  }

  @Post('auth/hardware-key/login/options')
  hardwareKeyLoginOptions(@Body() body: { userId: string }) {
    return this.webauthn.authenticationOptions(body.userId);
  }

  @Post('auth/hardware-key/login/verify')
  async verifyHardwareKeyLogin(
    @Body()
    body: {
      userId: string;
      response: Parameters<WebAuthnService['verifyAuthentication']>[1];
    },
  ) {
    const identityId = await this.webauthn.verifyAuthentication(
      body.userId,
      body.response,
    );
    return this.adminService.loginWithHardwareKey(identityId);
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

  @Get('senders/:profileId/reveal')
  async revealSenderProfile(
    @Headers('authorization') authorization: string | undefined,
    @Param('profileId') profileId: string,
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.revealSenderProfile(actor.id, profileId);
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

  @Post('reconciliations/:reconciliationId/ownership')
  async assignReconciliation(
    @Headers('authorization') authorization: string | undefined,
    @Param('reconciliationId') reconciliationId: string,
    @Body()
    body: { ownerIdentityId: string; reason: string; escalate?: boolean },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.assignReconciliation(
      actor.id,
      reconciliationId,
      body.ownerIdentityId,
      body.reason,
      body.escalate,
    );
  }

  @Post('alerts/:alertId/acknowledge')
  async acknowledgeAlert(
    @Headers('authorization') authorization: string | undefined,
    @Param('alertId') alertId: string,
    @Body() body: { reason: string },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.acknowledgeAlert(actor.id, alertId, body.reason);
  }

  @Post('alerts/:alertId/escalate')
  async escalateAlert(
    @Headers('authorization') authorization: string | undefined,
    @Param('alertId') alertId: string,
    @Body() body: { reason: string },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.escalateAlert(actor.id, alertId, body.reason);
  }

  @Post('transactions/:reference/status-recheck')
  async recheckStatus(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.recheckStatus(actor.id, reference);
  }

  @Post('transactions/:reference/reconciliation')
  async queueReconciliation(
    @Headers('authorization') authorization: string | undefined,
    @Param('reference') reference: string,
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.queueReconciliation(actor.id, reference);
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

  @Get('verifications')
  async listVerificationCases(
    @Headers('authorization') authorization: string | undefined,
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.listVerificationCases(actor.id);
  }

  @Post('verifications/:verificationId/review')
  async reviewVerification(
    @Headers('authorization') authorization: string | undefined,
    @Param('verificationId') verificationId: string,
    @Body()
    body: {
      decision: 'APPROVED' | 'REJECTED' | 'ESCALATED';
      decisionReason: string;
    },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.reviewVerification(actor.id, {
      verificationId,
      decision: body.decision,
      decisionReason: body.decisionReason,
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

  @Post('policies/tier-1-transfer-caps')
  async setTier1TransferCaps(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { perTransferLimitMinor: string; dailyLimitMinor: string },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.setTier1TransferCaps(
      actor.id,
      BigInt(body.perTransferLimitMinor),
      BigInt(body.dailyLimitMinor),
    );
  }

  @Post('pilot/controls')
  async setPilotControl(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: { key: PilotControlKey; state: PilotControlState; reason: string },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.setPilotControl(
      actor.id,
      body.key,
      body.state,
      body.reason,
    );
  }

  @Post('pilot/engineering-isolation')
  async isolateProviderMovement(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { reason: string },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.isolateProviderMovement(actor.id, body.reason);
  }

  @Post('pilot/release/approvals')
  async recordPilotApproval(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: { role: string; note: string },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.recordPilotApproval(
      actor.id,
      body.role,
      body.note,
    );
  }

  @Post('pilot/release/publish')
  async publishPilotReadiness(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Parameters<AdminService['publishPilotReadiness']>[1],
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.publishPilotReadiness(actor.id, body);
  }

  @Post('pilot/allowlist/:profileId')
  async setPilotAllowlist(
    @Headers('authorization') authorization: string | undefined,
    @Param('profileId') profileId: string,
    @Body() body: { enabled: boolean; reason: string },
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.setPilotAllowlist(
      actor.id,
      profileId,
      body.enabled,
      body.reason,
    );
  }

  @Post('pilot/exposure-policy')
  async setPilotExposurePolicy(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Parameters<AdminService['setPilotExposurePolicy']>[1],
  ) {
    const actor = await this.actor(authorization);
    return this.adminService.setPilotExposurePolicy(actor.id, body);
  }

  private async actor(authorization: string | undefined) {
    const [scheme, token] = authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token)
      throw new UnauthorizedException('Bearer admin session token is required');
    return this.adminService.actorFromSession(token);
  }
}
