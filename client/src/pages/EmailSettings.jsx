import { useState } from 'react';
import { Mail, Send, RefreshCw, ShieldCheck, AlertTriangle, Server } from 'lucide-react';
import { useGet, useAction, useToast } from '../lib/hooks';
import { Badge, CardSkeleton, Modal, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { dateTime, titleCase } from '../lib/format';

function Status() {
  const [verify, setVerify] = useState(false);
  const { data, isLoading, isFetching, refetch } = useGet('emails/status', verify ? { verify: 1 } : null, { fresh: true });
  if (isLoading) return <CardSkeleton lines={3} />;
  const smtp = data.mode === 'smtp';
  const v = data.verify;
  return (
    <div className="card card-pad" data-testid="email-status">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={cx('flex h-11 w-11 items-center justify-center rounded-xl', smtp ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10' : 'bg-amber-50 text-amber-600 dark:bg-amber-500/10')}>
            {smtp ? <Server size={20} /> : <AlertTriangle size={20} />}
          </div>
          <div>
            <div className="font-semibold">{smtp ? `Delivering via SMTP · ${data.host}` : 'SMTP not configured — emails are logged only'}</div>
            <p className="mt-0.5 max-w-2xl text-sm muted">
              {smtp
                ? `Emails are queued and sent in the background with automatic retries.${data.from ? ` From: ${data.from}` : ''}`
                : 'Every email is still generated and recorded below, but nothing leaves the server. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM on the server to start delivering.'}
            </p>
            {v && <p className={cx('mt-2 text-sm font-medium', v.ok ? 'text-emerald-600' : 'text-rose-600')} data-testid="smtp-verify">{v.ok ? 'Connection verified ✓' : `Connection failed: ${v.error}`}</p>}
          </div>
        </div>
        {smtp && <button className="btn-secondary btn-sm" disabled={isFetching} onClick={() => (verify ? refetch() : setVerify(true))}><ShieldCheck size={14} /> {isFetching ? 'Checking…' : 'Verify connection'}</button>}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {['sent', 'logged', 'queued', 'retrying', 'failed'].map((k) => <Badge key={k} status={k}>{titleCase(k)} · {data.counts[k] || 0}</Badge>)}
      </div>
    </div>
  );
}

export default function EmailSettings() {
  const [status, setStatus] = useState('');
  const { data = [], isLoading } = useGet('emails', { status }, { poll: 10000 });
  const [act, { isLoading: sending }] = useAction();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [viewId, setViewId] = useState(null);
  const { data: mail } = useGet(viewId ? `emails/${viewId}` : null);

  return (
    <div className="space-y-6">
      <Status />
      <form className="card card-pad flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={async (e) => {
        e.preventDefault();
        // Writing to the "emails" root refreshes both the status counts and the log.
        const r = await act('emails/test', { body: { to } });
        if (r) toast(r.status === 'failed' || r.status === 'retrying' ? `Delivery failed: ${r.last_error}` : r.status === 'sent' ? `Test email delivered to ${r.to_email}` : `Logged (SMTP not configured): ${r.to_email}`, r.status === 'sent' || r.status === 'logged' ? 'success' : 'error');
      }}>
        <div className="flex-1">
          <label className="label" htmlFor="test-email">Send a test email</label>
          <input id="test-email" type="email" required className="input" placeholder="you@company.com" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button className="btn-primary" disabled={sending} data-testid="send-test-email"><Send size={16} /> {sending ? 'Sending…' : 'Send test'}</button>
      </form>
      <DataTable title="Email log" loading={isLoading} rows={data} searchKeys={['to_email', 'to_name', 'subject', 'template']} exportName="email-log" onRowClick={(r) => setViewId(r.id)} testId="email-log"
        toolbar={<select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Email status filter">
          <option value="">All statuses</option>{['sent', 'logged', 'queued', 'retrying', 'failed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
        </select>}
        columns={[
          { key: 'created_at', header: 'Queued (UTC)', render: (r) => dateTime(r.created_at) },
          { key: 'to_email', header: 'To', width: 'minmax(200px, 1.5fr)', render: (r) => <div className="min-w-0"><div className="truncate font-medium">{r.to_name || r.to_email}</div>{r.to_name && <div className="truncate text-xs muted">{r.to_email}</div>}</div> },
          { key: 'subject', header: 'Subject', width: 'minmax(240px, 2.5fr)' },
          { key: 'template', header: 'Type', render: (r) => titleCase(r.template) },
          { key: 'status', header: 'Status', render: (r) => <span title={r.last_error || ''}><Badge status={r.status} /></span> },
          { key: 'attempts', header: 'Tries', width: '70px' },
          { key: 'r', header: '', sortable: false, csv: false, width: '90px', render: (r) => ['failed', 'retrying'].includes(r.status) && (
            <button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); act(`emails/${r.id}/retry`, { success: 'Retry attempted' }); }}><RefreshCw size={13} /> Retry</button>
          ) },
        ]} />
      <Modal open={!!viewId} onClose={() => setViewId(null)} title={mail?.subject || 'Email'} size="lg">
        {mail ? (
          <div className="space-y-3" data-testid="email-preview">
            <div className="flex flex-wrap items-center gap-2 text-sm"><Mail size={14} className="text-slate-400" /><span>To <b>{mail.to_name ? `${mail.to_name} <${mail.to_email}>` : mail.to_email}</b></span><Badge status={mail.status} /></div>
            {mail.last_error && <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{mail.last_error}</p>}
            {/* Sandboxed: rendered email HTML can't run scripts or reach the app. */}
            <iframe title="Email preview" sandbox="" srcDoc={mail.html} className="h-[60vh] w-full rounded-xl border border-slate-200 bg-white dark:border-slate-700" />
          </div>
        ) : <CardSkeleton lines={6} />}
      </Modal>
    </div>
  );
}
