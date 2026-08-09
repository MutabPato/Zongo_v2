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
import { AdminV1ExceptionFilter } from './admin-v1-exception.filter';
import * as AdminV1Dto from './admin-v1.dto';
import {
  parseBreakGlass,
  parseDecimal,
  parseLogin,
  parseNote,
  parseReason,
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
  hardwareKeyLoginOptions(@Body() body: AdminV1Dto.UserIdBody) {
    return this.webauthn.authenticationOptions(body.userId);
  }

  @Post('auth/webauthn/login/verify')
  async verifyHardwareKeyLogin(
    @Body()
    body: {
      userId: string;
      response: Parameters<WebAuthnService['verifyAuthentication']>[1];
    },
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
  async hardwareKeyRegistrationOptions(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.webauthn.registrationOptions(actor.id);
  }

  @Post('auth/webauthn/registration/verify')
  async verifyHardwareKeyRegistration(
    @Req() request: Request,
    @Body()
    body: { response: Parameters<WebAuthnService['verifyRegistration']>[1] },
  ) {
    const actor = await this.actor(request);
    return this.webauthn.verifyRegistration(actor.id, body.response);
  }

  @Post('auth/break-glass')
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
  ) {
    const accessToken = this.sessionToken(request, false);
    if (accessToken) await this.adminService.revokeSession(accessToken);
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
  async retryPayout(
    @Req() request: Request,
    @Param('reference') reference: string,
    @Body() body: AdminV1Dto.RetryPayoutBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.retryFailedPayout(
      actor.id,
      reference,
      body.correctedBeneficiaryId,
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

  @Post('reconciliation/:id/notes')
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
  async assignReconciliation(
    @Req() request: Request,
    @Param('id') id: string,
    @Body()
    body: AdminV1Dto.ReconciliationAssignmentBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    if (!body.ownerIdentityId || !body.reason?.trim())
      throw new ForbiddenException('Owner and reason are required');
    return this.adminService.assignReconciliation(
      actor.id,
      id,
      body.ownerIdentityId,
      body.reason.trim(),
      body.escalate,
    );
  }

  @Get('verification')
  async verification(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.listVerificationCasesPage(
      actor.id,
      this.pagination(request),
    );
  }

  @Post('verification/:id/review')
  async verificationReview(
    @Req() request: Request,
    @Param('id') id: string,
    @Body()
    body: AdminV1Dto.VerificationReviewBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    if (
      !['APPROVED', 'REJECTED', 'ESCALATED'].includes(body.decision) ||
      !body.decisionReason?.trim()
    )
      throw new ForbiddenException('A valid decision and reason are required');
    return this.adminService.reviewVerification(actor.id, {
      verificationId: id,
      ...body,
      decisionReason: body.decisionReason.trim(),
    });
  }

  @Get('alerts')
  async alerts(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.listAlerts(actor.id, this.pagination(request));
  }

  @Post('alerts/:id/acknowledge')
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

  @Get('audit')
  async audit(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.auditTrail(actor.id, this.pagination(request));
  }

  @Get('admin-controls')
  async controls(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.adminControls(actor.id);
  }

  @Get('pilot/readiness')
  async pilotReadiness(@Req() request: Request) {
    const actor = await this.actor(request);
    return this.adminService.getPilotReadiness(actor.id);
  }

  @Post('admin-controls/pilot')
  async pilotControl(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotControlBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    if (!body.reason?.trim())
      throw new ForbiddenException('A reason is required');
    if (
      !Object.values(PilotControlKey).includes(body.key as PilotControlKey) ||
      !Object.values(PilotControlState).includes(
        body.state as PilotControlState,
      )
    )
      throw new ForbiddenException('Invalid pilot control');
    return this.adminService.setPilotControl(
      actor.id,
      body.key as PilotControlKey,
      body.state as PilotControlState,
      body.reason.trim(),
    );
  }

  @Post('admin-controls/users/block')
  async blockUser(
    @Req() request: Request,
    @Body() body: AdminV1Dto.UserBlockBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    if (!body.userId || typeof body.blocked !== 'boolean')
      throw new ForbiddenException('User and block state are required');
    return this.adminService.setUserBlocked(
      actor.id,
      body.userId,
      body.blocked,
      body.reason,
    );
  }

  @Post('admin-controls/tier-1-caps')
  async tierOneCaps(
    @Req() request: Request,
    @Body() body: AdminV1Dto.TierOneCapsBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.setTier1TransferCaps(
      actor.id,
      BigInt(parseDecimal(body.perTransferLimitMinor, 'perTransferLimitMinor')),
      BigInt(parseDecimal(body.dailyLimitMinor, 'dailyLimitMinor')),
    );
  }

  @Post('admin-controls/pilot/allowlist')
  async pilotAllowlist(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotAllowlistBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    if (
      !body.senderProfileId ||
      typeof body.enabled !== 'boolean' ||
      !body.reason?.trim()
    )
      throw new ForbiddenException(
        'Allowlist target, state, and reason are required',
      );
    return this.adminService.setPilotAllowlist(
      actor.id,
      body.senderProfileId,
      body.enabled,
      body.reason.trim(),
    );
  }

  @Post('admin-controls/pilot/exposure-policy')
  async pilotExposurePolicy(
    @Req() request: Request,
    @Body() body: AdminV1Dto.ExposurePolicyBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.setPilotExposurePolicy(actor.id, {
      ...body,
      maxPartnerSettlementMinor:
        body.maxPartnerSettlementMinor == null
          ? body.maxPartnerSettlementMinor
          : BigInt(body.maxPartnerSettlementMinor as unknown as string),
      globalDailySendMinor:
        body.globalDailySendMinor == null
          ? body.globalDailySendMinor
          : BigInt(body.globalDailySendMinor as unknown as string),
    });
  }

  @Post('pilot/readiness/approvals')
  async pilotApproval(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotApprovalBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.recordPilotApproval(
      actor.id,
      body.role,
      body.note ?? '',
    );
  }

  @Post('pilot/readiness/stages')
  async pilotStage(
    @Req() request: Request,
    @Body()
    body: AdminV1Dto.PilotStageBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.recordPilotReadinessStage(
      actor.id,
      body.stage,
      body,
    );
  }

  @Post('pilot/readiness/publish')
  async publishPilot(
    @Req() request: Request,
    @Body() body: AdminV1Dto.PilotPublishBody,
    @Headers('x-csrf-token') csrfToken?: string,
  ) {
    const accessToken = this.mutationToken(request, csrfToken);
    const actor = await this.adminService.actorFromSession(accessToken);
    return this.adminService.publishPilotReadiness(actor.id, body);
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
