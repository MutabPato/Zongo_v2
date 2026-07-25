import React, { useEffect, useState } from 'react'
import { ApiClient } from 'adminjs'

const api = new ApiClient()

const resourceUrl = (resource) => `/backoffice/resources/${resource}`

const Metric = ({ label, value, tone = 'primary' }) => (
  <section style={{ background: '#fff', borderRadius: 8, boxShadow: '0 2px 8px #00000012', padding: 24, minWidth: 180, flex: '1 1 180px' }}>
    <div style={{ color: '#64748b', fontWeight: 700, fontSize: 13 }}>{label}</div>
    <div style={{ color: tone === 'error' ? '#b91c1c' : tone === 'warning' ? '#b45309' : '#0f766e', fontSize: 34, fontWeight: 700 }}>{value}</div>
  </section>
)

const LinkButton = ({ href, children, secondary = false }) => (
  <a href={href} style={{ display: 'inline-block', marginRight: 12, marginTop: 8, padding: '10px 14px', borderRadius: 6, textDecoration: 'none', color: secondary ? '#1e3a5f' : '#fff', background: secondary ? '#e2e8f0' : '#1d4ed8', fontWeight: 700 }}>
    {children}
  </a>
)

const OperationsDashboard = () => {
  const [data, setData] = useState()
  const [error, setError] = useState()

  useEffect(() => {
    api.getDashboard()
      .then((response) => setData(response.data))
      .catch(() => setError('Unable to load the operations dashboard. Refresh and try again.'))
  }, [])

  if (error) return <main style={{ padding: 32 }}><h1>Operations control plane</h1><p style={{ color: '#b91c1c' }}>{error}</p></main>
  if (!data) return <main style={{ padding: 32 }}>Loading operations dashboard…</main>

  const failed = data.failed || []
  const pending = data.pending || []
  const reconciliation = data.reconciliation || []
  const alerts = data.alerts || []

  return (
    <main style={{ padding: 32, maxWidth: 1200 }} data-testid="operations-dashboard">
      <header style={{ marginBottom: 28 }}>
        <h1 style={{ marginBottom: 8 }}>Operations control plane</h1>
        <p style={{ color: '#64748b' }}>Role: <strong>{data.role}</strong> · MFA-protected operational workflows</p>
      </header>

      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 28 }}>
        <Metric label="Failed payouts / collections" value={failed.length} tone={failed.length ? 'error' : 'success'} />
        <Metric label="Pending transfers" value={pending.length} tone={pending.length ? 'warning' : 'success'} />
        <Metric label="Reconciliation exceptions" value={reconciliation.length} tone={reconciliation.length ? 'error' : 'success'} />
        <Metric label="Alert deliveries" value={alerts.length} />
      </section>

      <section style={{ background: '#fff', padding: 24, borderRadius: 8, marginBottom: 20 }}>
        <h2>Operational actions</h2>
        <p>Search and investigate a transfer, then use the record actions to add notes, queue a status recheck, or prepare an eligible payout retry.</p>
        <LinkButton href={resourceUrl('TransferTransaction')}>Investigate transfers</LinkButton>
        <LinkButton href={resourceUrl('TransactionReconciliation')} secondary>Review reconciliation</LinkButton>
        <LinkButton href={resourceUrl('Beneficiary')} secondary>Review beneficiaries</LinkButton>
      </section>

      <section style={{ background: '#fff', padding: 24, borderRadius: 8, marginBottom: 20 }}>
        <h2>Failed transfers requiring review</h2>
        {failed.length ? failed.map((transaction) => (
          <div key={transaction.id} style={{ borderTop: '1px solid #e2e8f0', padding: '12px 0', display: 'flex', justifyContent: 'space-between' }}>
            <div><strong>{transaction.reference}</strong><div style={{ color: '#64748b' }}>{transaction.status} · {transaction.failedReason || 'No reason recorded'}</div></div>
            <LinkButton href={`${resourceUrl('TransferTransaction')}/${transaction.id}/show`}>Open transfer</LinkButton>
          </div>
        )) : <p style={{ color: '#64748b' }}>No failed transfers in the current queue.</p>}
      </section>

      <section style={{ background: '#fff', padding: 24, borderRadius: 8 }}>
        <h2>Security and policy</h2>
        <p>Manage Tier 0 limits, account blocks, immutable audit events, and alert delivery status.</p>
        <LinkButton href={resourceUrl('TierLimitPolicy')}>Tier 0 transfer caps</LinkButton>
        <LinkButton href={resourceUrl('PlatformIdentity')} secondary>Identity controls</LinkButton>
        <LinkButton href={resourceUrl('AuditEvent')} secondary>Audit trail</LinkButton>
      </section>
    </main>
  )
}

export default OperationsDashboard
