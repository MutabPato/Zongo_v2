export type AdminRole = 'SUPPORT' | 'OPS' | 'ADMIN';

export type AdminCapabilities = {
  viewOperations: boolean;
  viewReconciliation: boolean;
  addReconciliationNotes: boolean;
  assignReconciliation: boolean;
  viewBeneficiaries: boolean;
  viewAlerts: boolean;
  handleAlerts: boolean;
  viewVerification: boolean;
  reviewVerification: boolean;
  revealSender: boolean;
  recoverTransactions: boolean;
  viewAudit: boolean;
  viewPilotReadiness: boolean;
  managePilotControls: boolean;
  viewAdminControls: boolean;
  manageAdminControls: boolean;
};

export type AdminSession = {
  id: string;
  userId: string;
  role: AdminRole;
  mfaVerifiedAt: string | null;
  blockedAt: string | null;
  expiresAt?: string;
  lastUsedAt?: string | null;
  source?: string;
  capabilities: AdminCapabilities;
};

export type Overview = {
  role: AdminRole;
  failed: Array<Record<string, unknown>>;
  pending: Array<Record<string, unknown>>;
  reconciliation: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  canAdminister: boolean;
};

export type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};

export type WorkflowRecord = Record<string, unknown> & { id?: string };

export type BeneficiarySummary = WorkflowRecord & {
  id: string;
  displayName: string;
  phoneNumber?: string | null;
};

export type AdminControlsSnapshot = {
  controls: WorkflowRecord[];
  tier1: WorkflowRecord | null;
  exposure: WorkflowRecord | null;
  allowlistCount: number;
};

export type PilotReadiness = WorkflowRecord & {
  stage?: string;
  approvals?: WorkflowRecord[];
  stageRecords?: WorkflowRecord[];
};

export type TransactionInvestigation = {
  transaction: Record<string, unknown>;
  sender: Record<string, unknown> | null;
};

export type ApiError = {
  code?: string;
  message: string;
  correlationId?: string;
};

export class AdminApiError extends Error {
  readonly status: number;
  readonly details: ApiError;

  constructor(status: number, details: ApiError) {
    super(
      details.correlationId
        ? `${details.message} (correlation: ${details.correlationId})`
        : details.message,
    );
    this.name = 'AdminApiError';
    this.status = status;
    this.details = details;
  }
}

const jsonHeaders = { 'Content-Type': 'application/json' };

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...jsonHeaders, ...init.headers },
  });
  const body = (await response.json().catch(() => ({}))) as T | ApiError;
  if (!response.ok) {
    throw new AdminApiError(response.status, body as ApiError);
  }
  return body as T;
}

export async function loadCollection<T>(path: string) {
  return request<T>(path);
}

export async function login(userId: string, totpCode: string) {
  return request<{ expiresAt: string }>('/admin/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ userId, totpCode }),
  });
}

export async function webauthnLoginOptions(userId: string) {
  return request<Record<string, unknown>>(
    '/admin/v1/auth/webauthn/login/options',
    {
      method: 'POST',
      body: JSON.stringify({ userId }),
    },
  );
}

export async function webauthnLoginVerify(
  userId: string,
  response: Record<string, unknown>,
) {
  return request<{ expiresAt: string }>(
    '/admin/v1/auth/webauthn/login/verify',
    {
      method: 'POST',
      body: JSON.stringify({ userId, response }),
    },
  );
}

export async function webauthnRegistrationOptions(csrfToken: string) {
  return request<Record<string, unknown>>(
    '/admin/v1/auth/webauthn/registration/options',
    {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({}),
    },
  );
}

export async function webauthnRegistrationVerify(
  response: Record<string, unknown>,
  csrfToken: string,
) {
  return request<Record<string, unknown>>(
    '/admin/v1/auth/webauthn/registration/verify',
    {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ response }),
    },
  );
}

export async function breakGlass(
  userId: string,
  emergencySecret: string,
  reason: string,
) {
  return request<{ expiresAt: string; emergency: true }>(
    '/admin/v1/auth/break-glass',
    {
      method: 'POST',
      body: JSON.stringify({ userId, emergencySecret, reason }),
    },
  );
}

export async function loadSession() {
  return request<AdminSession>('/admin/v1/auth/session');
}

export async function loadCsrfToken() {
  return request<{ token: string }>('/admin/v1/auth/csrf');
}

export async function logout() {
  const csrfToken = (await loadCsrfToken()).token;
  return request<{ loggedOut: boolean }>('/admin/v1/auth/logout', {
    method: 'POST',
    headers: { 'X-CSRF-Token': csrfToken },
  });
}

export async function loadOverview() {
  return request<Overview>('/admin/v1/overview');
}

export async function searchOperations(
  query: string,
  page = 1,
  status?: string,
) {
  const params = new URLSearchParams({ q: query, page: String(page) });
  if (status) params.set('status', status);
  return request<Page<Record<string, unknown>>>(
    `/admin/v1/operations/search?${params.toString()}`,
  );
}

export async function loadInvestigation(reference: string) {
  return request<TransactionInvestigation>(
    `/admin/v1/operations/transactions/${encodeURIComponent(reference)}`,
  );
}

export async function addTransactionNote(
  reference: string,
  csrfToken: string,
  body: string,
) {
  return mutate<Record<string, unknown>>(
    `/admin/v1/operations/transactions/${encodeURIComponent(reference)}/notes`,
    csrfToken,
    { body },
  );
}

export async function recheckStatus(reference: string, csrfToken: string) {
  return mutate<Record<string, unknown>>(
    `/admin/v1/operations/transactions/${encodeURIComponent(reference)}/status-recheck`,
    csrfToken,
  );
}

export async function retryPayout(reference: string, csrfToken: string) {
  return mutate<Record<string, unknown>>(
    `/admin/v1/operations/transactions/${encodeURIComponent(reference)}/retry-payout`,
    csrfToken,
  );
}

export async function queueReconciliation(
  reference: string,
  csrfToken: string,
) {
  return mutate<Record<string, unknown>>(
    `/admin/v1/operations/transactions/${encodeURIComponent(reference)}/reconciliation`,
    csrfToken,
  );
}

export async function revealSender(profileId: string, csrfToken: string) {
  return mutate<Record<string, unknown>>(
    `/admin/v1/operations/senders/${encodeURIComponent(profileId)}/reveal`,
    csrfToken,
  );
}

export async function loadBeneficiaryDetail(id: string) {
  return request<BeneficiarySummary>(
    `/admin/v1/beneficiaries/${encodeURIComponent(id)}`,
  );
}

export async function loadBeneficiaries(
  search: string,
  page = 1,
  pageSize = 25,
) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (search.trim()) params.set('search', search.trim());
  return request<Page<BeneficiarySummary>>(
    `/admin/v1/beneficiaries?${params.toString()}`,
  );
}

export async function loadAdminControls() {
  return request<AdminControlsSnapshot>('/admin/v1/admin-controls');
}

export async function loadPilotReadiness() {
  return request<PilotReadiness | null>('/admin/v1/pilot/readiness');
}

export async function mutate<T>(
  path: string,
  csrfToken: string,
  body?: unknown,
): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: {
      'X-CSRF-Token': csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
