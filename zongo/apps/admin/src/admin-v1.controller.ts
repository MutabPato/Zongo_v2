import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminService } from './admin.service';
import { WebAuthnService } from './webauthn.service';
import {
  PilotControlKey,
  PilotControlState,
  TransactionStatus,
} from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { ApiBody } from '@nestjs/swagger';
import { AdminV1ExceptionFilter } from './admin-v1-exception.filter';
import * as AdminV1Dto from './admin-v1.dto';
import {
  parseBreakGlass,
  parseExposurePolicy,
  parseLogin,
  parseNote,
  parsePilotAllowlist,
  parsePilotApproval,
  parsePilotControl,
  parsePilotPublish,
  parsePilotStage,
  parseReconciliationAssignment,
  parseReason,
  parseRetryPayout,
  parseTierOneCaps,
  parseUserBlock,
  parseUserId,
  parseVerificationReview,
} from './admin-v1.dto';

const SESSION_COOKIE = 'zongo_admin_session';

type BrowserResponse = Response & {
  cookie: (
    name: string,
    value: string,
    options: Record<string, unknown>,
  ) => void;
  clearCookie: (name: string, options: Record<string, unknown>) => void;
};

/** Canonical browser-facing control-plane contract. Legacy bearer routes stay in AdminController. */
@Controller('admin/v1')
@ApiTags('admin-v1')
@UseFilters(AdminV1ExceptionFilter)
export class AdminV1Controller {
  constructor(
    private readonly adminService: AdminService,
    private readonly webauthn: WebAuthnService,
  ) {}

  @Post('auth/login')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.login })
  async login(
    @Body() input: AdminV1Dto.LoginBody,
    @Res({ passthrough: true }) response: BrowserResponse,
  ) {
    const body = parseLogin(input);
    const session = await this.adminService.login(body.userId, body.totpCode);
    this.setSessionCookie(response, session.accessToken);
    return { expiresAt: session.expiresAt };
  }

  @Post('auth/webauthn/login/options')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string' } },
    },
  })
  hardwareKeyLoginOptions(@Body() input: AdminV1Dto.UserIdBody) {
    const body = parseUserId(input);
    return this.webauthn.authenticationOptions(body.userId);
  }

  @Post('auth/webauthn/login/verify')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['userId', 'response'],
      properties: {
        userId: { type: 'string' },
        response: { type: 'object', additionalProperties: true },
      },
    },
  })
  async verifyHardwareKeyLogin(
    @Body()
    body: AdminV1Dto.WebAuthnLoginBody,
    @Res({ passthrough: true }) response: BrowserResponse,
  ) {
    const identityId = await this.webauthn.verifyAuthentication(
      body.userId,
      body.response,
    );
    const session = await this.adminService.loginWithHardwareKey(identityId);
    this.setSessionCookie(response, session.accessToken);
    return { expiresAt: session.expiresAt };
  }

  @Post('auth/webauthn/registration/options')
  async hardwareKeyRegistrationOptions(
    @Req() request: Request,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.webauthn.registrationOptions(actor.id);
  }

  @Post('auth/webauthn/registration/verify')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['response'],
      properties: { response: { type: 'object', additionalProperties: true } },
    },
  })
  async verifyHardwareKeyRegistration(
    @Req() request: Request,
    @Body()
    body: AdminV1Dto.WebAuthnRegistrationBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.webauthn.verifyRegistration(actor.id, body.response);
  }

  @Post('auth/break-glass')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.breakGlass })
  async breakGlass(
    @Body() input: AdminV1Dto.BreakGlassBody,
    @Res({ passthrough: true }) response: BrowserResponse,
  ) {
    const body = parseBreakGlass(input);
    const session = await this.adminService.useBreakGlass(
      body.userId,
      body.emergencySecret,
      body.reason.trim(),
    );
    this.setSessionCookie(response, session.accessToken);
    return { expiresAt: session.expiresAt, emergency: true };
  }

  @Get('auth/csrf')
  async csrf(@Req() request: Request) {
    const accessToken = this.sessionToken(request);
    await this.adminService.actorFromSession(accessToken);
    return { token: this.adminService.csrfToken(accessToken) };
  }

  @Get('auth/session')
  async session(@Req() request: Request) {
    return this.adminService.sessionDetails(this.sessionToken(request));
  }

  @Post('auth/logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: BrowserResponse,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.sessionToken(request, false);
    if (accessToken) {
      const sessionToken = this.mutationToken(request, csrfToken);
      await this.adminService.logoutSession(sessionToken);
    }
    response.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    return { loggedOut: true };
  }

  @Get('overview')
  async overview(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.dashboard(actor.id);
  }

  @Get('operations/search')
  async searchOperations(@Req() request: Request) {
    const actor = await this.actor(request);
    const url = new URL(request.url, 'http://admin.local');
    const rawPage = Number(url.searchParams.get('page') ?? '1');
    const status = url.searchParams.get('status') as TransactionStatus | null;
    return this.adminService.searchOperations(actor.id, {
      q: url.searchParams.get('q') ?? undefined,
      status: status ?? undefined,
      page: Number.isFinite(rawPage) ? rawPage : 1,
    });
  }

  @Get('operations/transactions/:reference')
  async investigateTransaction(
    @Req() request: Request,
    @Param('reference') reference: string,
  ) {
    const actor = await this.actor(request);
    return this.adminService.investigateTransfer(actor.id, reference);
  }

  @Post('operations/transactions/:reference/notes')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.note })
  async addTransactionNote(
    @Req() request: Request,
    @Param('reference') reference: string,
    @Body() input: AdminV1Dto.NoteBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const body = parseNote(input);
    return this.adminService.addTransactionNote(actor.id, reference, body.body);
  }

  @Post('operations/transactions/:reference/status-recheck')
  async recheckStatus(
    @Req() request: Request,
    @Param('reference') reference: string,
    @Headers('x-csrf-token') csrfToken?: string,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.recheckStatus(actor.id, reference, idempotencyKey);
  }

  @Post('operations/transactions/:reference/retry-payout')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.retryPayout })
  async retryPayout(
    @Req() request: Request,
    @Param('reference') reference: string,
    @Body() body: AdminV1Dto.RetryPayoutBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const input = parseRetryPayout(body);
    return this.adminService.retryFailedPayout(
      actor.id,
      reference,
      input.correctedBeneficiaryId,
    );
  }

  @Post('operations/transactions/:reference/reconciliation')
  async queueReconciliation(
    @Req() request: Request,
    @Param('reference') reference: string,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.queueReconciliation(actor.id, reference);
  }

  @Post('operations/senders/:profileId/reveal')
  async revealSender(
    @Req() request: Request,
    @Param('profileId') profileId: string,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.revealSenderProfile(actor.id, profileId);
  }

  @Get('reconciliation')
  async reconciliation(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.listReconciliations(
      actor.id,
      this.pagination(request),
    );
  }

  @Get('reconciliations')
  async reconciliations(@Req() request: Request) {
    return this.reconciliation(request);
  }

  @Get('reconciliations/:id')
  async reconciliationDetail(@Req() request: Request, @Param('id') id: string) {
    const actor = await this.actor(request);
    return this.adminService.getReconciliation(actor.id, id);
  }

  @Post('reconciliation/:id/notes')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.note })
  async reconciliationNote(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() input: AdminV1Dto.NoteBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const body = parseNote(input);
    return this.adminService.addReconciliationNote(actor.id, id, body.body);
  }

  @Post('reconciliation/:id/assign')
  @ApiBody({
    schema: AdminV1Dto.AdminV1OpenApiSchemas.reconciliationAssignment,
  })
  async assignReconciliation(
    @Req() request: Request,
    @Param('id') id: string,
    @Body()
    body: AdminV1Dto.ReconciliationAssignmentBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const input = parseReconciliationAssignment(body);
    return this.adminService.assignReconciliation(
      actor.id,
      id,
      input.ownerIdentityId,
      input.reason,
      input.escalate,
    );
  }

  @Post('reconciliations/:id/notes')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.note })
  async canonicalReconciliationNote(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() input: AdminV1Dto.NoteBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.reconciliationNote(request, id, input, csrfToken);
  }

  @Post('reconciliations/:id/ownership')
  @ApiBody({
    schema: AdminV1Dto.AdminV1OpenApiSchemas.reconciliationAssignment,
  })
  async canonicalReconciliationOwnership(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: AdminV1Dto.ReconciliationAssignmentBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.assignReconciliation(request, id, body, csrfToken);
  }

  @Get('verification')
  async verification(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.listVerificationCasesPage(
      actor.id,
      this.pagination(request),
    );
  }

  @Get('verification/:id')
  async verificationDetail(@Req() request: Request, @Param('id') id: string) {
    const actor = await this.actor(request);
    return this.adminService.verificationCase(actor.id, id);
  }

  @Post('verification/:id/review')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.verificationReview })
  async verificationReview(
    @Req() request: Request,
    @Param('id') id: string,
    @Body()
    body: AdminV1Dto.VerificationReviewBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const input = parseVerificationReview(body);
    return this.adminService.reviewVerification(actor.id, {
      verificationId: id,
      ...input,
    });
  }

  @Get('alerts')
  async alerts(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.listAlerts(actor.id, this.pagination(request));
  }

  @Get('alerts/:id')
  async alertDetail(@Req() request: Request, @Param('id') id: string) {
    const actor = await this.actor(request);
    return this.adminService.alertDetail(actor.id, id);
  }

  @Post('alerts/:id/acknowledge')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.reason })
  async acknowledgeAlert(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() input: AdminV1Dto.AlertReasonBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const body = parseReason(input);
    return this.adminService.acknowledgeAlert(actor.id, id, body.reason);
  }

  @Post('alerts/:id/escalate')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.reason })
  async escalateAlert(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() input: AdminV1Dto.AlertReasonBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const body = parseReason(input);
    return this.adminService.escalateAlert(actor.id, id, body.reason);
  }

  @Get('beneficiaries')
  async beneficiaries(@Req() request: Request) {
    const actor = await this.actor(request);
    const url = new URL(request.url, 'http://admin.local');
    const pagination = this.pagination(request);
    return this.adminService.reviewBeneficiariesPage(actor.id, {
      search: url.searchParams.get('search') ?? undefined,
      corridorId: url.searchParams.get('corridorId') ?? undefined,
      userId: url.searchParams.get('userId') ?? undefined,
      ...pagination,
    });
  }

  @Get('beneficiaries/:id')
  async beneficiaryDetail(@Req() request: Request, @Param('id') id: string) {
    const actor = await this.actor(request);
    return this.adminService.reviewBeneficiary(actor.id, id);
  }

  @Get('audit')
  async audit(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.auditTrail(actor.id, this.pagination(request));
  }

  @Get('audit/:id')
  async auditDetail(@Req() request: Request, @Param('id') id: string) {
    const actor = await this.actor(request);
    return this.adminService.auditEvent(actor.id, id);
  }

  @Get('users')
  async users(@Req() request: Request) {
    const actor = await this.actor(request);
    const url = new URL(request.url, 'http://admin.local');
    return this.adminService.listAdminUsers(
      actor.id,
      this.pagination(request),
      url.searchParams.get('search') ?? undefined,
    );
  }

  @Get('users/:id')
  async userDetail(@Req() request: Request, @Param('id') id: string) {
    const actor = await this.actor(request);
    return this.adminService.adminUser(actor.id, id);
  }

  @Get('admin-controls')
  async controls(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.adminControls(actor.id);
  }

  @Get('policies/tier-1-transfer-caps')
  async tierOneCapsPolicy(@Req() request: Request) {
    const actor = await this.actor(request);
    const snapshot = (await this.adminService.adminControls(actor.id)) as {
      tier1?: unknown;
    };
    return snapshot.tier1 ?? null;
  }

  @Get('pilot/readiness')
  async pilotReadiness(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.getPilotReadiness(actor.id);
  }

  @Get('pilot/release')
  async pilotRelease(@Req() request: Request) {
    return this.pilotReadiness(request);
  }

  @Post('admin-controls/pilot')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.pilotControl })
  async pilotControl(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotControlBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const input = parsePilotControl(body);
    if (
      !Object.values(PilotControlKey).includes(input.key as PilotControlKey) ||
      !Object.values(PilotControlState).includes(
        input.state as PilotControlState,
      )
    )
      throw new ForbiddenException('Invalid pilot control');
    return this.adminService.setPilotControl(
      actor.id,
      input.key as PilotControlKey,
      input.state as PilotControlState,
      input.reason,
    );
  }

  @Post('admin-controls/users/block')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.userBlock })
  async blockUser(
    @Req() request: Request,
    @Body() body: AdminV1Dto.UserBlockBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const input = parseUserBlock(body);
    return this.adminService.setUserBlocked(
      actor.id,
      input.userId,
      input.blocked,
      input.reason,
    );
  }

  @Post('admin-controls/tier-1-caps')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.tierCaps })
  async tierOneCaps(
    @Req() request: Request,
    @Body() body: AdminV1Dto.TierOneCapsBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const input = parseTierOneCaps(body);
    return this.adminService.setTier1TransferCaps(
      actor.id,
      BigInt(input.perTransferLimitMinor),
      BigInt(input.dailyLimitMinor),
    );
  }

  @Post('admin-controls/pilot/allowlist')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.pilotAllowlist })
  async pilotAllowlist(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotAllowlistBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const input = parsePilotAllowlist(body);
    return this.adminService.setPilotAllowlist(
      actor.id,
      input.senderProfileId,
      input.enabled,
      input.reason,
    );
  }

  @Post('admin-controls/pilot/exposure-policy')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.exposurePolicy })
  async pilotExposurePolicy(
    @Req() request: Request,
    @Body() body: AdminV1Dto.ExposurePolicyBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const input = parseExposurePolicy(body);
    return this.adminService.setPilotExposurePolicy(actor.id, {
      ...input,
      maxPartnerSettlementMinor:
        input.maxPartnerSettlementMinor == null
          ? input.maxPartnerSettlementMinor
          : BigInt(input.maxPartnerSettlementMinor),
      globalDailySendMinor:
        input.globalDailySendMinor == null
          ? input.globalDailySendMinor
          : BigInt(input.globalDailySendMinor),
    });
  }

  @Post('pilot/readiness/approvals')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.pilotApproval })
  async pilotApproval(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotApprovalBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const input = parsePilotApproval(body);
    return this.adminService.recordPilotApproval(
      actor.id,
      input.role,
      input.note,
    );
  }

  @Post('pilot/readiness/stages')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.pilotStage })
  async pilotStage(
    @Req() request: Request,
    @Body()
    body: AdminV1Dto.PilotStageBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    const input = parsePilotStage(body);
    return this.adminService.recordPilotReadinessStage(
      actor.id,
      input.stage,
      input,
    );
  }

  @Post('pilot/readiness/publish')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.pilotPublish })
  async publishPilot(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotPublishBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.publishPilotReadiness(
      actor.id,
      parsePilotPublish(body),
    );
  }

  @Post('users/:id/block')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.userBlock })
  async canonicalUserBlock(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: AdminV1Dto.UserBlockBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.blockUser(
      request,
      { ...body, userId: id, blocked: true },
      csrfToken,
    );
  }

  @Post('users/:id/unblock')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.userBlock })
  async canonicalUserUnblock(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: AdminV1Dto.UserBlockBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.blockUser(
      request,
      { ...body, userId: id, blocked: false },
      csrfToken,
    );
  }

  @Post('policies/tier-1-transfer-caps')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.tierCaps })
  async canonicalTierOneCaps(
    @Req() request: Request,
    @Body() body: AdminV1Dto.TierOneCapsBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.tierOneCaps(request, body, csrfToken);
  }

  @Post('pilot/controls')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.pilotControl })
  async canonicalPilotControls(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotControlBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.pilotControl(request, body, csrfToken);
  }

  @Post('pilot/allowlist/:profileId')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.pilotAllowlist })
  async canonicalPilotAllowlist(
    @Req() request: Request,
    @Param('profileId') profileId: string,
    @Body() body: AdminV1Dto.PilotAllowlistBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.pilotAllowlist(
      request,
      { ...body, senderProfileId: profileId },
      csrfToken,
    );
  }

  @Post('pilot/exposure-policy')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.exposurePolicy })
  async canonicalPilotExposurePolicy(
    @Req() request: Request,
    @Body() body: AdminV1Dto.ExposurePolicyBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.pilotExposurePolicy(request, body, csrfToken);
  }

  @Post('pilot/engineering-isolation')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.reason })
  async canonicalEngineeringIsolation(
    @Req() request: Request,
    @Body() input: AdminV1Dto.AlertReasonBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.isolateProviderMovement(
      actor.id,
      parseReason(input).reason,
    );
  }

  @Post('pilot/release/approvals')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.pilotApproval })
  async canonicalPilotApprovals(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotApprovalBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.pilotApproval(request, body, csrfToken);
  }

  @Post('pilot/release/stages/:stage')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.pilotStage })
  async canonicalPilotStages(
    @Req() request: Request,
    @Param('stage') stage: string,
    @Body() body: AdminV1Dto.PilotStageBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.pilotStage(request, { ...body, stage }, csrfToken);
  }

  @Post('pilot/release/publish')
  @ApiBody({ schema: AdminV1Dto.AdminV1OpenApiSchemas.pilotPublish })
  async canonicalPilotPublication(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotPublishBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    return this.publishPilot(request, body, csrfToken);
  }

  private async actor(request: Request) {
    const accessToken = this.sessionToken(request);
    return this.adminService.actorFromSession(accessToken);
  }

  private mutationToken(
    request: Request,
    csrfToken: string | undefined,
  ): string {
    this.assertSameOrigin(request);
    const accessToken = this.sessionToken(request);
    this.adminService.assertCsrfToken(accessToken, csrfToken);
    return accessToken;
  }

  private assertSameOrigin(request: Request): void {
    const origin = request.headers.origin ?? request.headers.referer;
    if (!origin) return;
    const expected = process.env.ADMIN_ORIGIN ?? process.env.WEBAUTHN_ORIGIN;
    if (!expected)
      throw new ForbiddenException('Admin origin is not configured');
    let actualOrigin: string;
    try {
      actualOrigin = new URL(origin).origin;
    } catch {
      throw new ForbiddenException('Invalid admin origin');
    }
    if (actualOrigin !== new URL(expected).origin)
      throw new ForbiddenException('Cross-origin admin mutation rejected');
  }

  private sessionToken(request: Request, required?: true): string;
  private sessionToken(request: Request, required: false): string | undefined;
  private sessionToken(request: Request, required = true): string | undefined {
    const cookies = this.cookies(request.headers.cookie);
    const cookieToken = cookies[SESSION_COOKIE];
    const [scheme, bearer] = request.headers.authorization?.split(' ') ?? [];
    const token = cookieToken ?? (scheme === 'Bearer' ? bearer : undefined);
    if (!token && required)
      throw new UnauthorizedException('Admin browser session is required');
    return token;
  }

  private cookies(header: string | undefined): Record<string, string> {
    return Object.fromEntries(
      (header ?? '')
        .split(';')
        .map((part) => part.trim().split('='))
        .filter(([name, value]) => name && value)
        .map(([name, value]) => [name, decodeURIComponent(value)]),
    );
  }

  private pagination(request: Request): { page: number; pageSize: number } {
    const url = new URL(request.url, 'http://admin.local');
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '25');
    return {
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 25,
    };
  }

  private setSessionCookie(response: BrowserResponse, token: string): void {
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.ADMIN_COOKIE_SECURE !== 'false',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60 * 1000,
    });
  }
}
