import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  CircularProgress,
  CssBaseline,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  ThemeProvider,
  Toolbar,
  Typography,
  createTheme,
} from '@mui/material';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import CompareArrowsOutlined from '@mui/icons-material/CompareArrowsOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import PeopleOutlineOutlined from '@mui/icons-material/PeopleOutlineOutlined';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import AdminPanelSettingsOutlined from '@mui/icons-material/AdminPanelSettingsOutlined';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import * as api from './api';

const drawerWidth = 244;
const theme = createTheme({
  palette: {
    primary: { main: '#3478f6' },
    background: { default: '#f4f6fa', paper: '#ffffff' },
  },
  shape: { borderRadius: 12 },
  typography: { fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' },
});

const navigation = [
  ['Overview', '/', DashboardOutlined],
  ['Transactions', '/transactions', ReceiptLongOutlined],
  ['Reconciliation', '/reconciliation', CompareArrowsOutlined],
  ['Verification', '/verification', FactCheckOutlined],
  ['Beneficiaries', '/beneficiaries', PeopleOutlineOutlined],
  ['Alerts', '/alerts', NotificationsNoneOutlined],
  ['Pilot readiness', '/pilot', RocketLaunchOutlined],
  ['Audit trail', '/audit', HistoryOutlined],
  ['Admin controls', '/admin-controls', AdminPanelSettingsOutlined],
] as const;

function base64UrlBytes(value: string): ArrayBuffer {
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice((value.length + 3) % 4);
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function credentialResponse(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAssertionResponse;
  const encode = (value: ArrayBuffer | null) =>
    value
      ? btoa(String.fromCharCode(...new Uint8Array(value)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
      : null;
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      authenticatorData: encode(response.authenticatorData),
      signature: encode(response.signature),
      userHandle: encode(response.userHandle),
    },
    type: credential.type,
  };
}

function registrationResponse(credential: PublicKeyCredential) {
  const response = credential.response as AuthenticatorAttestationResponse;
  const encode = (value: ArrayBuffer | null) =>
    value
      ? btoa(String.fromCharCode(...new Uint8Array(value)))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '')
      : null;
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    response: {
      clientDataJSON: encode(response.clientDataJSON),
      attestationObject: encode(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
    type: credential.type,
  };
}

function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [userId, setUserId] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'totp' | 'break-glass'>('totp');
  const [emergencySecret, setEmergencySecret] = useState('');
  const [reason, setReason] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    setLoading(true);
    try {
      if (mode === 'break-glass') {
        if (
          !window.confirm(
            'Enter isolated break-glass mode? This creates prominent audit evidence and a 30-minute emergency session.',
          )
        )
          return;
        await api.breakGlass(userId.trim(), emergencySecret, reason);
      } else {
        await api.login(userId.trim(), totpCode.trim());
      }
      onLoggedIn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  }

  async function hardwareKeyLogin() {
    setError(undefined);
    setLoading(true);
    try {
      if (!window.PublicKeyCredential)
        throw new Error('This browser does not support WebAuthn');
      const options = await api.webauthnLoginOptions(userId.trim());
      const publicKey = {
        ...options,
        challenge: base64UrlBytes(String(options.challenge)),
        allowCredentials: Array.isArray(options.allowCredentials)
          ? options.allowCredentials.map((entry) => ({
              ...(entry as Record<string, unknown>),
              id: base64UrlBytes(String((entry as Record<string, unknown>).id)),
            }))
          : undefined,
      };
      const credential = await navigator.credentials.get({
        publicKey: publicKey as PublicKeyCredentialRequestOptions,
      });
      if (!credential || !(credential instanceof PublicKeyCredential))
        throw new Error('No hardware key response was received');
      await api.webauthnLoginVerify(
        userId.trim(),
        credentialResponse(credential),
      );
      onLoggedIn();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Hardware-key login failed',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box
      className="auth-background"
      display="grid"
      sx={{ minHeight: '100vh', placeItems: 'center', p: 3 }}
    >
      <Paper
        component="form"
        onSubmit={submit}
        elevation={0}
        sx={{ width: '100%', maxWidth: 440, p: 4 }}
      >
        <Typography
          color="primary"
          fontWeight={800}
          letterSpacing=".12em"
          variant="overline"
        >
          ZONGO OPERATIONS
        </Typography>
        <Typography variant="h4" fontWeight={800} sx={{ mt: 1 }}>
          Sign in securely
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
          MFA-protected access to the operations control plane.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack spacing={2}>
          <TextField
            label="Admin identity"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            autoComplete="username"
            required
          />
          {mode === 'totp' ? (
            <TextField
              label="TOTP code"
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
              autoComplete="one-time-code"
              inputMode="numeric"
              required
            />
          ) : (
            <>
              <Alert severity="warning">
                Emergency access is isolated, short-lived, and prominently
                audited.
              </Alert>
              <TextField
                label="Emergency secret"
                type="password"
                value={emergencySecret}
                onChange={(event) => setEmergencySecret(event.target.value)}
                required
              />
              <TextField
                label="Explicit reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                multiline
                minRows={2}
                required
              />
            </>
          )}
          <Button
            type="submit"
            variant="contained"
            size="large"
            disabled={loading}
          >
            {loading ? (
              <CircularProgress size={22} color="inherit" />
            ) : mode === 'totp' ? (
              'Continue with TOTP'
            ) : (
              'Enter break-glass mode'
            )}
          </Button>
          <Button
            type="button"
            onClick={() => setMode(mode === 'totp' ? 'break-glass' : 'totp')}
          >
            {mode === 'totp'
              ? 'Use isolated break-glass access'
              : 'Return to standard MFA'}
          </Button>
          {mode === 'totp' && (
            <Button
              type="button"
              variant="outlined"
              onClick={hardwareKeyLogin}
              disabled={loading}
            >
              Continue with hardware key
            </Button>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}

function Overview({ session }: { session: api.AdminSession }) {
  const [data, setData] = useState<api.Overview>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api
      .loadOverview()
      .then(setData)
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : 'Unable to load overview',
        ),
      );
  }, []);
  const cards = data
    ? [
        ['Failed transfers', String(data.failed.length), 'Needs review'],
        ['Pending transfers', String(data.pending.length), 'Monitor'],
        [
          'Reconciliation exceptions',
          String(data.reconciliation.length),
          'Assigned work',
        ],
        ['Alert deliveries', String(data.alerts.length), 'Healthy'],
      ]
    : [];
  return (
    <Stack spacing={3}>
      <Box>
        <Typography
          color="primary"
          fontWeight={800}
          letterSpacing=".12em"
          variant="overline"
        >
          TRIAGE COCKPIT
        </Typography>
        <Typography variant="h4" fontWeight={800}>
          Good morning
        </Typography>
        <Typography color="text.secondary">
          Start with the queues that need a decision. Every action is audited.
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      <Box
        display="grid"
        gap={2}
        gridTemplateColumns={{ xs: '1fr 1fr', md: 'repeat(4, 1fr)' }}
      >
        {cards.length ? (
          cards.map(([label, value, status]) => (
            <Paper key={label} sx={{ p: 2.5 }}>
              <Typography color="text.secondary" variant="body2">
                {label}
              </Typography>
              <Typography variant="h3" fontWeight={800} sx={{ my: 0.75 }}>
                {value}
              </Typography>
              <Typography color="text.secondary" variant="caption">
                {status}
              </Typography>
            </Paper>
          ))
        ) : (
          <CircularProgress />
        )}
      </Box>
      <Box
        display="grid"
        gap={2}
        gridTemplateColumns={{ xs: '1fr', md: '1.3fr .8fr' }}
      >
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="h6" fontWeight={800}>
            Action queue
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Failed and pending transaction queues are now sourced from the
            role-aware overview read model.
          </Typography>
          <Button
            component={Link}
            to="/transactions"
            variant="contained"
            sx={{ mt: 2 }}
          >
            Investigate operations
          </Button>
        </Paper>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="h6" fontWeight={800}>
            Signed in as
          </Typography>
          <Typography sx={{ mt: 1 }}>{session.userId}</Typography>
          <Typography color="text.secondary">
            {session.role} · MFA verified
          </Typography>
        </Paper>
      </Box>
    </Stack>
  );
}

function Operations({ title }: { title: string }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<api.Page<Record<string, unknown>>>({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function search(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(undefined);
    try {
      setResults(await api.searchOperations(query, 1, status || undefined));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" fontWeight={800}>
          {title}
        </Typography>
        <Typography color="text.secondary">
          Search and investigate operational work through the explicit admin
          API.
        </Typography>
      </Box>
      <Paper
        component="form"
        onSubmit={search}
        sx={{ p: 2.5, display: 'flex', gap: 1.5, flexWrap: 'wrap' }}
      >
        <TextField
          fullWidth
          label="Reference, sender, beneficiary"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          size="small"
        />
        <TextField
          select
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          size="small"
          sx={{ minWidth: 190 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          {[
            'INITIATED',
            'PENDING_COLLECTION',
            'COLLECTION_SUCCESS',
            'COLLECTION_FAILED',
            'PENDING_PAYOUT',
            'PAYOUT_SUCCESS',
            'PAYOUT_FAILED',
          ].map((value) => (
            <MenuItem key={value} value={value}>
              {value}
            </MenuItem>
          ))}
        </TextField>
        <Button type="submit" variant="contained" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </Paper>
      {error && <Alert severity="error">{error}</Alert>}
      <Paper sx={{ p: 2.5 }}>
        <Typography color="text.secondary" variant="body2">
          {results.total} result(s)
        </Typography>
        {results.items.map((item, index) => (
          <Box
            key={String(item.id ?? index)}
            sx={{ py: 1.5, borderBottom: '1px solid #edf0f5' }}
          >
            <Typography color="primary" fontWeight={800}>
              <Link
                to={`/transactions/${encodeURIComponent(String(item.reference ?? item.id ?? ''))}`}
                style={{ color: 'inherit' }}
              >
                {String(item.reference ?? item.id ?? 'Operation')}
              </Link>
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {String(item.status ?? 'Unknown status')}
            </Typography>
          </Box>
        ))}
        {!results.items.length && (
          <Typography color="text.secondary" sx={{ py: 3 }}>
            Search for an operation to begin.
          </Typography>
        )}
        {results.total > results.pageSize && (
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button
              disabled={results.page <= 1 || loading}
              onClick={() => {
                setLoading(true);
                void api
                  .searchOperations(
                    query,
                    results.page - 1,
                    status || undefined,
                  )
                  .then(setResults)
                  .catch((cause) =>
                    setError(
                      cause instanceof Error ? cause.message : 'Search failed',
                    ),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              Previous
            </Button>
            <Button
              disabled={
                results.page * results.pageSize >= results.total || loading
              }
              onClick={() => {
                setLoading(true);
                void api
                  .searchOperations(
                    query,
                    results.page + 1,
                    status || undefined,
                  )
                  .then(setResults)
                  .catch((cause) =>
                    setError(
                      cause instanceof Error ? cause.message : 'Search failed',
                    ),
                  )
                  .finally(() => setLoading(false));
              }}
            >
              Next
            </Button>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

function TransactionInvestigation({ role }: { role: api.AdminRole }) {
  const { reference = '' } = useParams();
  const [data, setData] = useState<api.TransactionInvestigation>();
  const [csrf, setCsrf] = useState<string>();
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [revealedSender, setRevealedSender] =
    useState<Record<string, unknown>>();

  useEffect(() => {
    if (!reference) return;
    api
      .loadInvestigation(reference)
      .then(setData)
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : 'Unable to load transaction',
        ),
      );
  }, [reference]);

  async function action(
    run: (token: string) => Promise<unknown>,
    success: string,
  ) {
    setError(undefined);
    setMessage(undefined);
    try {
      const token = csrf ?? (await api.loadCsrfToken()).token;
      setCsrf(token);
      await run(token);
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed');
    }
  }

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <CircularProgress />;
  const transaction = data.transaction;
  const sender = data.sender;
  const senderProfileId = sender?.id ? String(sender.id) : undefined;
  const contextSections = [
    ['Ledger entries', transaction.ledgerEntries],
    ['Worker jobs', transaction.workerJobs],
    ['Transaction notes', transaction.adminNotes],
    ['Reconciliation', transaction.reconciliation],
    ['Audit events', transaction.auditEvents],
    ['Beneficiary context', transaction.beneficiary],
    ['Retry beneficiary', transaction.retryBeneficiary],
  ].filter(([, value]) => value !== undefined && value !== null);
  return (
    <Stack spacing={3}>
      <Box>
        <Button component={Link} to="/transactions" sx={{ mb: 1 }}>
          ← Back to transactions
        </Button>
        <Typography variant="h4" fontWeight={800}>
          {reference}
        </Typography>
        <Typography color="text.secondary">
          Investigation timeline and controlled recovery actions.
        </Typography>
      </Box>
      {message && <Alert severity="success">{message}</Alert>}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" fontWeight={800}>
          Transaction state
        </Typography>
        <Typography sx={{ mt: 1 }}>
          Status: {String(transaction.status ?? 'Unknown')}
        </Typography>
        <Typography color="text.secondary">
          Amount:{' '}
          {String(transaction.amountMinor ?? transaction.amount ?? 'Masked')}
        </Typography>
      </Paper>
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" fontWeight={800}>
          Sender context
        </Typography>
        <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
          Sensitive sender fields stay masked until an authorized operator
          explicitly reveals them.
        </Typography>
        {sender && (
          <Typography sx={{ mt: 1 }}>
            Profile: {senderProfileId ?? 'Unavailable'} · Email:{' '}
            {String(sender.email ?? '[MASKED]')}
          </Typography>
        )}
        {role !== 'SUPPORT' && senderProfileId && !revealedSender && (
          <Button
            color="warning"
            variant="outlined"
            sx={{ mt: 1.5 }}
            onClick={() => {
              if (
                !window.confirm(
                  'Reveal sensitive sender fields? This is restricted, no-store, and creates an audit alert.',
                )
              )
                return;
              void action(
                (token) =>
                  api
                    .revealSender(senderProfileId, token)
                    .then(setRevealedSender),
                'Sensitive sender fields revealed and audited',
              );
            }}
          >
            Reveal sender fields
          </Button>
        )}
        {revealedSender && (
          <Box
            component="pre"
            sx={{
              mt: 1.5,
              p: 1.5,
              bgcolor: '#fff8e1',
              borderRadius: 1,
              overflowX: 'auto',
            }}
          >
            {JSON.stringify(revealedSender, null, 2)}
          </Box>
        )}
      </Paper>
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" fontWeight={800}>
          Investigation context
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {contextSections.map(([label, value]) => (
            <Box key={label as string}>
              <Typography fontWeight={700}>{label as string}</Typography>
              <Box
                component="pre"
                sx={{
                  mt: 0.5,
                  mb: 0,
                  p: 1.25,
                  bgcolor: '#f7f9fc',
                  borderRadius: 1,
                  overflowX: 'auto',
                  fontSize: 12,
                }}
              >
                {JSON.stringify(value, null, 2)}
              </Box>
            </Box>
          ))}
        </Stack>
      </Paper>
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" fontWeight={800}>
          Operator actions
        </Typography>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          sx={{ mt: 2 }}
        >
          {role !== 'SUPPORT' && (
            <>
              <Button
                variant="outlined"
                onClick={() =>
                  action(
                    (token) => api.recheckStatus(reference, token),
                    'Status recheck queued',
                  )
                }
              >
                Recheck status
              </Button>
              <Button
                variant="outlined"
                onClick={() =>
                  action(
                    (token) => api.queueReconciliation(reference, token),
                    'Reconciliation queued',
                  )
                }
              >
                Queue reconciliation
              </Button>
              <Button
                variant="outlined"
                color="warning"
                onClick={() =>
                  action(
                    (token) => api.retryPayout(reference, token),
                    'Payout retry prepared',
                  )
                }
              >
                Prepare payout retry
              </Button>
            </>
          )}
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={1.5}>
          <TextField
            fullWidth
            size="small"
            label="Audited operator note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            disabled={!note.trim()}
            variant="contained"
            onClick={() =>
              action(
                (token) => api.addTransactionNote(reference, token, note),
                'Note added',
              ).then(() => setNote(''))
            }
          >
            Add note
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}

function BeneficiaryWorkspace() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<api.Page<Record<string, unknown>>>({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
  const [selected, setSelected] = useState<Record<string, unknown>>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function load(nextPage = 1) {
    setLoading(true);
    setError(undefined);
    try {
      const query = new URLSearchParams({
        page: String(nextPage),
        pageSize: '25',
      });
      if (search.trim()) query.set('search', search.trim());
      const result = await api.loadCollection(
        `/admin/v1/beneficiaries?${query.toString()}`,
      );
      setPage(result as api.Page<Record<string, unknown>>);
      setSelected(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load beneficiaries',
      );
    } finally {
      setLoading(false);
    }
  }

  function safeDetail(row: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(row).filter(
        ([key]) => !/ciphertext|blindindex|payoutaccount/i.test(key),
      ),
    );
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" fontWeight={800}>
          Beneficiary review
        </Typography>
        <Typography color="text.secondary">
          Search masked beneficiary records. Payout-sensitive fields are
          excluded from the review view.
        </Typography>
      </Box>
      <Paper
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void load(1);
        }}
        sx={{ p: 2.5, display: 'flex', gap: 1.5 }}
      >
        <TextField
          fullWidth
          size="small"
          label="Name or approved search value"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit" variant="contained" disabled={loading}>
          Search
        </Button>
      </Paper>
      {error && <Alert severity="error">{error}</Alert>}
      <Paper sx={{ p: 2.5 }}>
        <Typography color="text.secondary" variant="body2">
          {page.total} result(s) · page {page.page}
        </Typography>
        {loading ? (
          <CircularProgress sx={{ mt: 2 }} />
        ) : (
          page.items.map((row, index) => (
            <Box
              key={String(row.id ?? index)}
              sx={{ py: 1.5, borderBottom: '1px solid #edf0f5' }}
            >
              <Button
                sx={{
                  p: 0,
                  justifyContent: 'flex-start',
                  textTransform: 'none',
                }}
                onClick={() => setSelected(row)}
              >
                <Typography fontWeight={700}>
                  {String(row.displayName ?? row.id ?? 'Beneficiary')}
                </Typography>
              </Button>
              <Typography color="text.secondary" variant="body2">
                Phone: {String(row.phoneNumber ?? '[MASKED]')} · Status:{' '}
                {String(row.status ?? 'Unavailable')}
              </Typography>
            </Box>
          ))
        )}
        {!loading && !page.items.length && (
          <Typography color="text.secondary" sx={{ py: 3 }}>
            No beneficiaries found.
          </Typography>
        )}
        {selected && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" fontWeight={800}>
              Selected beneficiary
            </Typography>
            <Box
              component="pre"
              sx={{
                mt: 1,
                p: 1.5,
                bgcolor: '#f7f9fc',
                borderRadius: 1,
                overflowX: 'auto',
              }}
            >
              {JSON.stringify(safeDetail(selected), null, 2)}
            </Box>
          </Box>
        )}
        {page.total > page.pageSize && (
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button
              disabled={page.page <= 1 || loading}
              onClick={() => void load(page.page - 1)}
            >
              Previous
            </Button>
            <Button
              disabled={page.page * page.pageSize >= page.total || loading}
              onClick={() => void load(page.page + 1)}
            >
              Next
            </Button>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

function AdminControlsWorkspace({ role }: { role: api.AdminRole }) {
  const [snapshot, setSnapshot] = useState<Record<string, unknown>>();
  const [userId, setUserId] = useState('');
  const [userReason, setUserReason] = useState('');
  const [perTransfer, setPerTransfer] = useState('');
  const [daily, setDaily] = useState('');
  const [pilotKey, setPilotKey] = useState('GLOBAL');
  const [pilotState, setPilotState] = useState('PAUSED');
  const [pilotReason, setPilotReason] = useState('');
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setSnapshot(
        (await api.loadCollection('/admin/v1/admin-controls')) as Record<
          string,
          unknown
        >,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to load admin controls',
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  if (role !== 'ADMIN')
    return (
      <Alert severity="error">Admin role is required for this workspace.</Alert>
    );

  async function submit(path: string, body: unknown, success: string) {
    setError(undefined);
    setMessage(undefined);
    try {
      const token = (await api.loadCsrfToken()).token;
      await api.mutate(path, token, body);
      setMessage(success);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Administrative action failed',
      );
    }
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" fontWeight={800}>
          Admin controls
        </Typography>
        <Typography color="text.secondary">
          Identity, policy, and pilot controls. Every mutation is reasoned,
          authorized, and audited server-side.
        </Typography>
      </Box>
      {message && <Alert severity="success">{message}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" fontWeight={800}>
          Current policy snapshot
        </Typography>
        {loading ? (
          <CircularProgress sx={{ mt: 2 }} />
        ) : (
          <Box
            component="pre"
            sx={{
              mt: 1.5,
              p: 1.5,
              bgcolor: '#f7f9fc',
              borderRadius: 1,
              overflowX: 'auto',
            }}
          >
            {JSON.stringify(snapshot, null, 2)}
          </Box>
        )}
      </Paper>
      <Box
        display="grid"
        gap={2}
        gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }}
      >
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="h6" fontWeight={800}>
            Block or unblock identity
          </Typography>
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            <TextField
              label="Identity user id"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            />
            <TextField
              label="Reason"
              value={userReason}
              onChange={(event) => setUserReason(event.target.value)}
              multiline
              minRows={2}
            />
            <Stack direction="row" spacing={1}>
              <Button
                variant="contained"
                color="warning"
                disabled={!userId.trim() || !userReason.trim()}
                onClick={() =>
                  void submit(
                    '/admin/v1/admin-controls/users/block',
                    { userId, blocked: true, reason: userReason },
                    'Identity blocked',
                  )
                }
              >
                Block
              </Button>
              <Button
                variant="outlined"
                disabled={!userId.trim()}
                onClick={() =>
                  void submit(
                    '/admin/v1/admin-controls/users/block',
                    { userId, blocked: false, reason: userReason || undefined },
                    'Identity unblocked',
                  )
                }
              >
                Unblock
              </Button>
            </Stack>
          </Stack>
        </Paper>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="h6" fontWeight={800}>
            Tier 1 transfer caps
          </Typography>
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            <TextField
              label="Per-transfer limit (minor units)"
              value={perTransfer}
              onChange={(event) => setPerTransfer(event.target.value)}
              inputMode="numeric"
            />
            <TextField
              label="Daily limit (minor units)"
              value={daily}
              onChange={(event) => setDaily(event.target.value)}
              inputMode="numeric"
            />
            <Button
              variant="contained"
              disabled={!/^\d+$/.test(perTransfer) || !/^\d+$/.test(daily)}
              onClick={() =>
                void submit(
                  '/admin/v1/admin-controls/tier-1-caps',
                  {
                    perTransferLimitMinor: perTransfer,
                    dailyLimitMinor: daily,
                  },
                  'Tier 1 caps updated',
                )
              }
            >
              Update caps
            </Button>
          </Stack>
        </Paper>
      </Box>
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" fontWeight={800}>
          Pilot control
        </Typography>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          sx={{ mt: 2 }}
        >
          <TextField
            label="Control key"
            value={pilotKey}
            onChange={(event) => setPilotKey(event.target.value)}
          />
          <TextField
            label="State"
            value={pilotState}
            onChange={(event) => setPilotState(event.target.value)}
          />
          <TextField
            fullWidth
            label="Reason"
            value={pilotReason}
            onChange={(event) => setPilotReason(event.target.value)}
          />
          <Button
            variant="contained"
            disabled={
              !pilotKey.trim() || !pilotState.trim() || !pilotReason.trim()
            }
            onClick={() =>
              void submit(
                '/admin/v1/admin-controls/pilot',
                { key: pilotKey, state: pilotState, reason: pilotReason },
                'Pilot control updated',
              )
            }
          >
            Apply
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}

function PilotReadinessWorkspace() {
  const [record, setRecord] = useState<Record<string, unknown> | null>();
  const [approvalRole, setApprovalRole] = useState('ENGINEERING');
  const [approvalNote, setApprovalNote] = useState('');
  const [stage, setStage] = useState('FOUNDATION_COMPLETE');
  const [evidenceRefs, setEvidenceRefs] = useState('{}');
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  async function load() {
    try {
      setRecord(
        (await api.loadCollection('/admin/v1/pilot/readiness')) as Record<
          string,
          unknown
        > | null,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to load Pilot readiness',
      );
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function action(path: string, body: unknown, success: string) {
    setError(undefined);
    setMessage(undefined);
    try {
      const token = (await api.loadCsrfToken()).token;
      await api.mutate(path, token, body);
      setMessage(success);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Pilot readiness action failed',
      );
    }
  }
  function parseJson(value: string, field: string) {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      throw new Error(`${field} must be valid JSON`);
    }
  }
  async function recordApproval() {
    if (!approvalNote.trim()) return;
    await action(
      '/admin/v1/pilot/readiness/approvals',
      { role: approvalRole, note: approvalNote },
      'Approval recorded',
    );
  }
  async function recordStage() {
    try {
      await action(
        '/admin/v1/pilot/readiness/stages',
        { stage, evidenceRefs: parseJson(evidenceRefs, 'Evidence references') },
        'Readiness stage recorded',
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Invalid readiness input',
      );
    }
  }

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" fontWeight={800}>
          Pilot readiness
        </Typography>
        <Typography color="text.secondary">
          Release evidence, approvals, stages, and publication remain governed
          by server-side authority rules.
        </Typography>
      </Box>
      {message && <Alert severity="success">{message}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <Paper sx={{ p: 2.5 }}>
        <Typography variant="h6" fontWeight={800}>
          Current readiness record
        </Typography>
        <Box
          component="pre"
          sx={{
            mt: 1.5,
            p: 1.5,
            bgcolor: '#f7f9fc',
            borderRadius: 1,
            overflowX: 'auto',
          }}
        >
          {JSON.stringify(record ?? {}, null, 2)}
        </Box>
      </Paper>
      <Box
        display="grid"
        gap={2}
        gridTemplateColumns={{ xs: '1fr', md: '1fr 1fr' }}
      >
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="h6" fontWeight={800}>
            Record approval
          </Typography>
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            <TextField
              label="Approval role"
              value={approvalRole}
              onChange={(event) => setApprovalRole(event.target.value)}
            />
            <TextField
              label="Approval note"
              value={approvalNote}
              onChange={(event) => setApprovalNote(event.target.value)}
              multiline
              minRows={2}
            />
            <Button
              variant="contained"
              disabled={!approvalRole.trim() || !approvalNote.trim()}
              onClick={() => void recordApproval()}
            >
              Record approval
            </Button>
          </Stack>
        </Paper>
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="h6" fontWeight={800}>
            Record evidence stage
          </Typography>
          <Stack spacing={1.5} sx={{ mt: 2 }}>
            <TextField
              label="Stage"
              value={stage}
              onChange={(event) => setStage(event.target.value)}
            />
            <TextField
              label="Evidence references (JSON)"
              value={evidenceRefs}
              onChange={(event) => setEvidenceRefs(event.target.value)}
              multiline
              minRows={3}
            />
            <Button variant="contained" onClick={() => void recordStage()}>
              Record stage
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Stack>
  );
}

function WorkflowPage({
  title,
  endpoint,
  role,
  detailEndpoint,
}: {
  title: string;
  endpoint: string;
  role: api.AdminRole;
  detailEndpoint?: string;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [page, setPage] = useState<api.Page<Record<string, unknown>>>({
    items: [],
    page: 1,
    pageSize: 25,
    total: 0,
  });
  const [detail, setDetail] = useState<Record<string, unknown>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  async function load(nextPage = 1) {
    setLoading(true);
    try {
      const value = await api.loadCollection(
        endpoint.includes('/pilot/')
          ? endpoint
          : `${endpoint}?page=${nextPage}&pageSize=25`,
      );
      const list = Array.isArray(value)
        ? value
        : ((value as { items?: Record<string, unknown>[] }).items ?? [
            value as Record<string, unknown>,
          ]);
      setRows(list as Record<string, unknown>[]);
      if (
        !Array.isArray(value) &&
        Array.isArray((value as api.Page<unknown>).items)
      )
        setPage(value as api.Page<Record<string, unknown>>);
      else
        setPage({
          items: list as Record<string, unknown>[],
          page: 1,
          pageSize: list.length || 25,
          total: list.length,
        });
      setDetail(undefined);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load workflow',
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [endpoint]);
  async function loadDetail(id: string) {
    if (!detailEndpoint) return;
    setError(undefined);
    try {
      setDetail(
        (await api.loadCollection(
          `${detailEndpoint}/${encodeURIComponent(id)}`,
        )) as Record<string, unknown>,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to load record detail',
      );
    }
  }
  async function alertAction(id: string, action: 'acknowledge' | 'escalate') {
    const reason = window.prompt('Reason for this audited action');
    if (!reason?.trim()) return;
    try {
      const token = (await api.loadCsrfToken()).token;
      const result = await api.mutate<{ handling?: string }>(
        `/admin/v1/alerts/${encodeURIComponent(id)}/${action}`,
        token,
        { reason },
      );
      setMessage(
        result.handling === 'ALREADY_HANDLED'
          ? 'Alert was already handled; no duplicate audit action was written.'
          : 'Alert handling accepted and audited.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed');
    }
  }
  async function verificationAction(
    id: string,
    decision: 'APPROVED' | 'REJECTED' | 'ESCALATED',
  ) {
    const decisionReason = window.prompt('Decision reason');
    if (!decisionReason?.trim()) return;
    try {
      const token = (await api.loadCsrfToken()).token;
      await api.mutate(
        `/admin/v1/verification/${encodeURIComponent(id)}/review`,
        token,
        { decision, decisionReason },
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review failed');
    }
  }
  async function reconciliationAction(
    id: string,
    action: 'notes' | 'assign' | 'escalate',
  ) {
    const reason = window.prompt(
      action === 'notes'
        ? 'Append-only reconciliation note'
        : action === 'escalate'
          ? 'Reason for reconciliation escalation'
          : 'Reason for ownership assignment',
    );
    if (!reason?.trim()) return;
    const body =
      action === 'notes'
        ? { body: reason }
        : {
            ownerIdentityId: window.prompt('Owner identity id') ?? '',
            reason,
            escalate: action === 'escalate',
          };
    const routeAction = action === 'notes' ? 'notes' : 'assign';
    try {
      const token = (await api.loadCsrfToken()).token;
      await api.mutate(
        `/admin/v1/reconciliation/${encodeURIComponent(id)}/${routeAction}`,
        token,
        body,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Reconciliation action failed',
      );
    }
  }
  async function pilotAction(key: string) {
    const reason = window.prompt('Reason for pilot control change');
    if (!reason?.trim()) return;
    try {
      const token = (await api.loadCsrfToken()).token;
      await api.mutate('/admin/v1/admin-controls/pilot', token, {
        key,
        state: 'PAUSED',
        reason,
      });
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Pilot control action failed',
      );
    }
  }
  function displayValue(value: unknown) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  }
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" fontWeight={800}>
          {title}
        </Typography>
        <Typography color="text.secondary">
          Role-aware operational records from the explicit admin API.
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success">{message}</Alert>}
      <Paper sx={{ p: 2.5 }}>
        {loading ? (
          <CircularProgress />
        ) : rows.length ? (
          rows.map((row, index) => (
            <Box
              key={String(row.id ?? index)}
              sx={{ py: 1.5, borderBottom: '1px solid #edf0f5' }}
            >
              <Typography fontWeight={700}>
                {String(
                  row.name ??
                    row.reference ??
                    row.actionName ??
                    row.status ??
                    row.id ??
                    'Record',
                )}
              </Typography>
              <Typography color="text.secondary" variant="body2">
                {displayValue(
                  row.reason ??
                    row.severity ??
                    row.createdAt ??
                    row.updatedAt ??
                    '',
                )}
              </Typography>
              {detailEndpoint && row.id !== undefined && row.id !== null && (
                <Button
                  size="small"
                  sx={{ mt: 1 }}
                  onClick={() => void loadDetail(String(row.id))}
                >
                  View details
                </Button>
              )}
              {Object.values(row).some(
                (value) => typeof value === 'object',
              ) && (
                <Box
                  component="pre"
                  sx={{
                    mt: 1,
                    mb: 0,
                    p: 1.5,
                    overflowX: 'auto',
                    bgcolor: '#f7f9fc',
                    borderRadius: 1,
                    fontSize: 12,
                  }}
                >
                  {displayValue(row)}
                </Box>
              )}
              {endpoint === '/admin/v1/alerts' && role !== 'SUPPORT' && (
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    onClick={() => alertAction(String(row.id), 'acknowledge')}
                  >
                    Acknowledge
                  </Button>
                  <Button
                    size="small"
                    color="warning"
                    onClick={() => alertAction(String(row.id), 'escalate')}
                  >
                    Escalate
                  </Button>
                </Stack>
              )}
              {endpoint === '/admin/v1/verification' && role !== 'SUPPORT' && (
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    color="success"
                    onClick={() =>
                      verificationAction(String(row.id), 'APPROVED')
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() =>
                      verificationAction(String(row.id), 'REJECTED')
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    size="small"
                    onClick={() =>
                      verificationAction(String(row.id), 'ESCALATED')
                    }
                  >
                    Escalate
                  </Button>
                </Stack>
              )}
              {endpoint === '/admin/v1/reconciliation' && (
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <Button
                    size="small"
                    onClick={() =>
                      reconciliationAction(String(row.id), 'notes')
                    }
                  >
                    Add note
                  </Button>
                  {role !== 'SUPPORT' && (
                    <>
                      <Button
                        size="small"
                        onClick={() =>
                          reconciliationAction(String(row.id), 'assign')
                        }
                      >
                        Assign owner
                      </Button>
                      <Button
                        size="small"
                        color="warning"
                        onClick={() =>
                          reconciliationAction(String(row.id), 'escalate')
                        }
                      >
                        Escalate
                      </Button>
                    </>
                  )}
                </Stack>
              )}
              {endpoint === '/admin/v1/admin-controls' &&
                role === 'ADMIN' &&
                Boolean(row.key) && (
                  <Button
                    size="small"
                    color="warning"
                    sx={{ mt: 1 }}
                    onClick={() => pilotAction(String(row.key))}
                  >
                    Pause control
                  </Button>
                )}
            </Box>
          ))
        ) : (
          <Typography color="text.secondary">
            No records require attention.
          </Typography>
        )}
        {detail && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" fontWeight={800}>
              Record detail
            </Typography>
            <Box
              component="pre"
              sx={{
                mt: 1,
                p: 1.5,
                overflowX: 'auto',
                bgcolor: '#f7f9fc',
                borderRadius: 1,
                fontSize: 12,
              }}
            >
              {JSON.stringify(detail, null, 2)}
            </Box>
          </Box>
        )}
        {page.total > page.pageSize && (
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button
              disabled={page.page <= 1 || loading}
              onClick={() => void load(page.page - 1)}
            >
              Previous
            </Button>
            <Button
              disabled={page.page * page.pageSize >= page.total || loading}
              onClick={() => void load(page.page + 1)}
            >
              Next
            </Button>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

function Shell({
  session,
  onLoggedOut,
}: {
  session: api.AdminSession;
  onLoggedOut: () => void;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const [registeringKey, setRegisteringKey] = useState(false);
  const [registrationMessage, setRegistrationMessage] = useState<string>();
  const active = useMemo(
    () => navigation.find(([, path]) => path === location.pathname)?.[1] ?? '/',
    [location.pathname],
  );
  const visibleNavigation = navigation.filter(([, path]) => {
    if (session.role === 'ADMIN') return true;
    if (session.role === 'SUPPORT')
      return [
        '/',
        '/transactions',
        '/reconciliation',
        '/beneficiaries',
        '/pilot',
        '/audit',
      ].includes(path);
    return path !== '/admin-controls';
  });
  async function signOut() {
    setLoggingOut(true);
    try {
      await api.logout();
      onLoggedOut();
    } finally {
      setLoggingOut(false);
    }
  }
  async function registerHardwareKey() {
    setRegistrationMessage(undefined);
    setRegisteringKey(true);
    try {
      if (!window.PublicKeyCredential)
        throw new Error('This browser does not support WebAuthn');
      const csrfToken = (await api.loadCsrfToken()).token;
      const options = await api.webauthnRegistrationOptions(csrfToken);
      const publicKey = {
        ...options,
        challenge: base64UrlBytes(String(options.challenge)),
        user: {
          ...(options.user as Record<string, unknown>),
          id: base64UrlBytes(
            String((options.user as Record<string, unknown>).id),
          ),
        },
        excludeCredentials: Array.isArray(options.excludeCredentials)
          ? options.excludeCredentials.map((entry) => ({
              ...(entry as Record<string, unknown>),
              id: base64UrlBytes(String((entry as Record<string, unknown>).id)),
            }))
          : undefined,
      };
      const credential = await navigator.credentials.create({
        publicKey: publicKey as PublicKeyCredentialCreationOptions,
      });
      if (!credential || !(credential instanceof PublicKeyCredential))
        throw new Error('No hardware key registration was received');
      await api.webauthnRegistrationVerify(
        registrationResponse(credential),
        csrfToken,
      );
      setRegistrationMessage('Hardware key registered');
    } catch (cause) {
      setRegistrationMessage(
        cause instanceof Error
          ? cause.message
          : 'Hardware-key registration failed',
      );
    } finally {
      setRegisteringKey(false);
    }
  }
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <CssBaseline />
      <AppBar
        position="fixed"
        elevation={0}
        sx={{ zIndex: (value) => value.zIndex.drawer + 1, bgcolor: '#12233f' }}
      >
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Typography fontWeight={800}>Zongo Operations</Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar
              sx={{ width: 30, height: 30, bgcolor: '#3478f6', fontSize: 13 }}
            >
              {session.role[0]}
            </Avatar>
            <Box>
              <Typography variant="body2" fontWeight={700}>
                {session.role}
              </Typography>
              <Typography variant="caption" sx={{ color: '#b8c7df' }}>
                MFA verified
              </Typography>
            </Box>
            <Button
              color="inherit"
              size="small"
              onClick={registerHardwareKey}
              disabled={registeringKey}
            >
              {registeringKey ? 'Registering…' : 'Register key'}
            </Button>
            <Button
              color="inherit"
              size="small"
              onClick={signOut}
              disabled={loggingOut}
            >
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </Stack>
          {registrationMessage && (
            <Alert severity="info" sx={{ mt: 1 }}>
              {registrationMessage}
            </Alert>
          )}
        </Toolbar>
      </AppBar>
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            bgcolor: '#12233f',
            color: '#c7d4e8',
            border: 0,
          },
        }}
      >
        <Toolbar />
        <Box sx={{ px: 1.5, py: 2 }}>
          <Typography fontWeight={800} sx={{ px: 1.5 }}>
            DOMAIN WORKSPACE
          </Typography>
          <List>
            {visibleNavigation.map(([label, path, Icon]) => (
              <ListItemButton
                key={path}
                selected={active === path}
                onClick={() => navigate(path)}
                sx={{
                  borderRadius: 1.5,
                  my: 0.35,
                  '&.Mui-selected': { bgcolor: '#243e68', color: '#fff' },
                }}
              >
                <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>
                  <Icon />
                </ListItemIcon>
                <ListItemText primary={label} />
              </ListItemButton>
            ))}
          </List>
        </Box>
        <Box sx={{ mt: 'auto', p: 2 }}>
          <Divider sx={{ borderColor: '#2b4164', mb: 2 }} />
          <Typography variant="caption">Self-hosted control plane</Typography>
        </Box>
      </Drawer>
      <Box
        component="main"
        sx={{ flexGrow: 1, p: { xs: 2, md: 4 }, mt: 8, ml: { xs: 0, md: 0 } }}
      >
        <Routes>
          <Route path="/" element={<Overview session={session} />} />
          <Route
            path="/transactions"
            element={<Operations title="Transactions" />}
          />
          <Route
            path="/transactions/:reference"
            element={<TransactionInvestigation role={session.role} />}
          />
          <Route path="/beneficiaries" element={<BeneficiaryWorkspace />} />
          <Route
            path="/admin-controls"
            element={<AdminControlsWorkspace role={session.role} />}
          />
          <Route path="/pilot" element={<PilotReadinessWorkspace />} />
          {navigation.slice(2).map(([label, path]) => (
            <Route
              key={path}
              path={path}
              element={
                <WorkflowPage
                  title={label}
                  role={session.role}
                  endpoint={
                    path === '/reconciliation'
                      ? '/admin/v1/reconciliation'
                      : path === '/verification'
                        ? '/admin/v1/verification'
                        : path === '/alerts'
                          ? '/admin/v1/alerts'
                          : path === '/audit'
                            ? '/admin/v1/audit'
                            : '/admin/v1/pilot/readiness'
                  }
                  detailEndpoint={
                    path === '/reconciliation'
                      ? '/admin/v1/reconciliations'
                      : path === '/verification'
                        ? '/admin/v1/verification'
                        : path === '/alerts'
                          ? '/admin/v1/alerts'
                          : path === '/audit'
                            ? '/admin/v1/audit'
                            : undefined
                  }
                />
              }
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Box>
    </Box>
  );
}

export function App() {
  const [session, setSession] = useState<api.AdminSession | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .loadSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {session ? (
        <Shell session={session} onLoggedOut={() => setSession(null)} />
      ) : (
        <Login onLoggedIn={() => api.loadSession().then(setSession)} />
      )}
    </ThemeProvider>
  );
}
