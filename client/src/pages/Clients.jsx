import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building, Plus, Pencil, Mail, Phone, Star, Trash2, Globe } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, Drawer, Tabs, EmptyState, CardSkeleton, StatCard, Confirm } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { money, date } from '../lib/format';

export const CLIENT_FIELDS = [
  { name: 'name', label: 'Client name', required: true },
  { name: 'code', label: 'Short code', placeholder: 'e.g. SKI' },
  { name: 'industry', label: 'Industry' },
  { name: 'website', label: 'Website' },
  { name: 'email', label: 'Billing email', type: 'email' },
  { name: 'phone', label: 'Phone' },
  { name: 'gstin', label: 'GSTIN', placeholder: '29ABCDE1234F1Z5' },
  { name: 'payment_terms_days', label: 'Payment terms (days)', type: 'number', min: 0, max: 180 },
  { name: 'currency', label: 'Currency', type: 'select', noEmpty: true, options: ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'] },
  { name: 'owner_id', label: 'Account owner', type: 'employee' },
  { name: 'status', label: 'Status', type: 'select', noEmpty: true, options: [['active', 'Active'], ['inactive', 'Inactive']] },
  { name: 'billing_address', label: 'Billing address', type: 'textarea', full: true },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
];

function ClientDrawer({ id, onClose, onEdit }) {
  const { isHR } = useAuth();
  const { data, isLoading } = useGet(id ? `clients/${id}/summary` : null);
  const [tab, setTab] = useState('contacts');
  const [act] = useAction();
  const addContact = useDisclosure();
  const c = data?.client;
  return (
    <Drawer open={!!id} onClose={onClose} title={c?.name || 'Client'} width="max-w-2xl">
      {isLoading || !c ? <CardSkeleton lines={6} /> : (
        <div className="space-y-5" data-testid="client-drawer">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 text-sm">
              <div className="flex flex-wrap gap-2"><Badge status={c.status} />{c.industry && <Badge color="slate">{c.industry}</Badge>}{c.code && <Badge color="violet">{c.code}</Badge>}</div>
              {c.email && <div className="flex items-center gap-1.5 muted"><Mail size={13} />{c.email}</div>}
              {c.website && <div className="flex items-center gap-1.5 muted"><Globe size={13} />{c.website}</div>}
              {c.gstin && <div className="muted">GSTIN {c.gstin} · {c.payment_terms_days} days terms · {c.currency}</div>}
            </div>
            <button className="btn-secondary btn-sm" onClick={() => onEdit(c)}><Pencil size={14} /> Edit</button>
          </div>
          <Tabs value={tab} onChange={setTab} tabs={[
            { value: 'contacts', label: 'Contacts', count: data.contacts.length }, { value: 'projects', label: 'Projects', count: data.projects.length },
            { value: 'opportunities', label: 'Opportunities', count: data.opportunities.length }, ...(isHR ? [{ value: 'invoices', label: 'Invoices', count: data.invoices.length }] : []),
          ]} />
          {tab === 'contacts' && (
            <div className="space-y-2">
              {data.contacts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 text-sm dark:border-slate-800" data-testid="client-contact">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-semibold">{p.name}{p.is_primary ? <Star size={12} className="fill-amber-400 text-amber-400" aria-label="Primary contact" /> : null}</div>
                    <div className="truncate text-xs muted">{[p.designation, p.email, p.phone].filter(Boolean).join(' · ')}</div>
                  </div>
                  <button className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" aria-label={`Remove ${p.name}`} onClick={() => act(`clients/contacts/${p.id}`, { method: 'DELETE', invalidates: ['clients'] })}><Trash2 size={14} /></button>
                </div>
              ))}
              {!data.contacts.length && <p className="text-sm muted">No contacts yet.</p>}
              <button className="btn-secondary btn-sm" onClick={() => addContact.onOpen()} data-testid="add-contact"><Plus size={14} /> Add contact</button>
            </div>
          )}
          {tab === 'projects' && (data.projects.length ? data.projects.map((p) => (
            <Link key={p.id} to={`/projects/${p.id}`} className="flex items-center justify-between rounded-xl border border-slate-100 p-3 text-sm hover:border-brand-300 dark:border-slate-800">
              <div><div className="font-semibold">{p.name}</div><div className="text-xs muted">{p.code} · {p.manager_name || 'No manager'}</div></div>
              <div className="flex gap-2"><Badge status={p.billing_type} /><Badge status={p.status} /></div>
            </Link>
          )) : <p className="text-sm muted">No projects yet.</p>)}
          {tab === 'opportunities' && (data.opportunities.length ? data.opportunities.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3 text-sm dark:border-slate-800">
              <div><div className="font-semibold">{o.name}</div><div className="text-xs muted">Close {date(o.expected_close)}</div></div>
              <div className="flex items-center gap-2"><span className="font-semibold">{money(o.value)}</span><Badge status={o.stage} /></div>
            </div>
          )) : <p className="text-sm muted">No opportunities yet.</p>)}
          {tab === 'invoices' && (data.invoices.length ? data.invoices.map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded-xl border border-slate-100 p-3 text-sm dark:border-slate-800">
              <div><div className="font-mono text-xs font-semibold">{i.number}</div><div className="text-xs muted">Issued {date(i.issue_date)} · due {date(i.due_date)}</div></div>
              <div className="flex items-center gap-2"><span className="font-semibold">{money(i.total)}</span><Badge status={i.status} /></div>
            </div>
          )) : <p className="text-sm muted">No invoices yet.</p>)}
          <FormModal open={addContact.open} onClose={addContact.onClose} title={`Add contact · ${c.name}`}
            fields={[{ name: 'name', label: 'Name', required: true }, { name: 'designation', label: 'Designation' }, { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' }, { name: 'is_primary', label: 'Primary contact (receives invoices)', type: 'checkbox', full: true }]}
            onSubmit={(v) => act(`clients/${c.id}/contacts`, { body: v, success: 'Contact added', invalidates: ['clients'] })} />
        </div>
      )}
    </Drawer>
  );
}

export default function Clients() {
  const { data = [], isLoading } = useGet('clients');
  const [act] = useAction();
  const form = useDisclosure();
  const [openId, setOpenId] = useState(null);
  const [del, setDel] = useState(null);
  const active = data.filter((c) => c.status === 'active');
  return (
    <div className="space-y-6">
      <PageHeader icon={Building} title="Clients" subtitle="Accounts you deliver projects for — contacts, billing details and relationships"
        actions={<button className="btn-primary" onClick={() => form.onOpen()} data-testid="new-client"><Plus size={16} /> New client</button>} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Building} label="Active clients" value={active.length} />
        <StatCard icon={Building} tone="sky" label="Active projects" value={data.reduce((a, c) => a + c.active_projects, 0)} />
        <StatCard icon={Building} tone="violet" label="Open opportunities" value={data.reduce((a, c) => a + c.open_opportunities, 0)} />
        <StatCard icon={Building} tone="amber" label="Receivables" value={money(data.reduce((a, c) => a + c.outstanding, 0))} />
      </div>
      <DataTable loading={isLoading} rows={data} searchKeys={['name', 'code', 'industry', 'owner_name']} exportName="clients" onRowClick={(r) => setOpenId(r.id)}
        empty={<EmptyState icon={Building} title="No clients yet" message="Add the organisations you deliver work for." />}
        columns={[
          { key: 'name', header: 'Client', width: 'minmax(220px, 1.6fr)', render: (r) => <div className="min-w-0"><div className="truncate font-semibold">{r.name}</div><div className="truncate text-xs muted">{[r.code, r.industry].filter(Boolean).join(' · ')}</div></div> },
          { key: 'owner_name', header: 'Owner', render: (r) => r.owner_name || '—' },
          { key: 'active_projects', header: 'Projects', align: 'right' },
          { key: 'open_opportunities', header: 'Pipeline', align: 'right' },
          { key: 'lifetime_billed', header: 'Billed', align: 'right', render: (r) => money(r.lifetime_billed) },
          { key: 'outstanding', header: 'Outstanding', align: 'right', render: (r) => (r.outstanding ? <b>{money(r.outstanding)}</b> : '—') },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
          { key: '_a', header: '', sortable: false, csv: false, width: '60px', render: (r) => <button className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" aria-label={`Delete ${r.name}`} onClick={(e) => { e.stopPropagation(); setDel(r); }}><Trash2 size={14} /></button> },
        ]} />
      <ClientDrawer id={openId} onClose={() => setOpenId(null)} onEdit={(c) => form.onOpen(c)} />
      <FormModal open={form.open} onClose={form.onClose} size="lg" title={form.payload ? `Edit ${form.payload.name}` : 'New client'} fields={CLIENT_FIELDS}
        initial={form.payload || { currency: 'INR', payment_terms_days: 30, status: 'active' }}
        onSubmit={(v) => {
          const body = Object.fromEntries(CLIENT_FIELDS.map((f) => [f.name, v[f.name] ?? null]));
          return form.payload ? act(`clients/${form.payload.id}`, { method: 'PUT', body, success: 'Client updated' }) : act('clients', { body, success: 'Client added' });
        }} />
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Delete client?" confirmLabel="Delete" message={`${del?.name} and its contacts will be removed. Clients with invoices can't be deleted.`}
        onConfirm={() => act(`clients/${del.id}`, { method: 'DELETE', success: 'Client deleted' })} />
    </div>
  );
}
