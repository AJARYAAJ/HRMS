import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LifeBuoy, Plus, MessageSquare, Paperclip, BookOpen, Search, ThumbsUp, Eye, Pencil, Trash2, Lightbulb } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure, useToast } from '../lib/hooks';
import { PageHeader, Badge, Avatar, Drawer, Tabs, Modal, Confirm, EmptyState, CardSkeleton, cx } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal, EmployeeSelect } from '../components/Form';
import { FileDrop, Attachments } from '../components/Files';
import { uploadAttachment, invalidateFiles } from '../lib/files';
import { timeAgo, dateTime } from '../lib/format';

function Tickets() {
  const { isHR, user } = useAuth();
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState(isHR ? 'all' : 'mine');
  const [subject, setSubject] = useState('');
  const { data: articles = [] } = useGet('kb');
  const [article, setArticle] = useState(null);
  const suggestions = useMemo(() => suggest(articles, subject), [articles, subject]);
  const { data = [], isLoading } = useGet('tickets', { status, ...(tab === 'mine' ? { mine: 1 } : {}) });
  const [act] = useAction();
  const add = useDisclosure();
  const [open, setOpen] = useState(null);
  const [resolution, setResolution] = useState('');
  useEffect(() => { if (params.get('new') === '1') { add.onOpen(); setParams({}); } }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  const ticket = open && data.find((t) => t.id === open.id);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {isHR ? <div className="flex rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {[['all', 'All tickets'], ['mine', 'My tickets']].map(([v, l]) => <button key={v} className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold', tab === v ? 'bg-white shadow-sm dark:bg-slate-700' : 'text-slate-500')} onClick={() => setTab(v)}>{l}</button>)}
        </div> : <span />}
        <button className="btn-primary" onClick={() => { setFile(null); add.onOpen(); }} data-testid="new-ticket"><Plus size={16} /> New ticket</button>
      </div>
      <DataTable loading={isLoading} rows={data} searchKeys={['subject', 'category', 'employee_name']} exportName="tickets" onRowClick={(r) => { setOpen(r); setResolution(r.resolution || ''); }}
        toolbar={<select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option>
        </select>}
        columns={[
          { key: 'id', header: '#', width: '70px', render: (r) => <span className="font-mono text-xs muted">#{r.id}</span> },
          { key: 'subject', header: 'Subject', width: 'minmax(240px, 2.5fr)', render: (r) => <div className="min-w-0"><div className="truncate font-semibold">{r.subject}</div><div className="truncate text-xs muted">{r.employee_name} · {timeAgo(r.created_at)}</div></div> },
          { key: 'category', header: 'Category' },
          { key: 'attachment_count', header: 'Files', width: '70px', render: (r) => (r.attachment_count ? <span className="flex items-center gap-1 text-brand-600 dark:text-brand-400"><Paperclip size={13} />{r.attachment_count}</span> : '—') },
          { key: 'priority', header: 'Priority', render: (r) => <Badge status={r.priority} /> },
          { key: 'assignee_name', header: 'Assignee', render: (r) => r.assignee_name || <span className="muted">Unassigned</span> },
          { key: 'status', header: 'Status', render: (r) => <Badge status={r.status} /> },
        ]} />
      <FormModal open={add.open} onClose={add.onClose} onValues={(v) => setSubject(`${v.subject || ''} ${v.description || ''}`)} title="Raise a ticket" submitLabel="Submit ticket" initial={{ priority: 'medium', category: 'HR' }}
        fields={[
          { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: ['HR', 'IT', 'Payroll', 'Facilities', 'Finance', 'Other'] },
          { name: 'priority', label: 'Priority', type: 'select', noEmpty: true, options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent']] },
          { name: 'subject', label: 'Subject', required: true, full: true },
          { name: 'description', label: 'Describe the issue', type: 'textarea', required: true, full: true },
        ]}
        onSubmit={async (v) => {
          const created = await act('tickets', { body: v });
          if (!created) return null;
          if (file) {
            try { await uploadAttachment('tickets', created.id, file); invalidateFiles('tickets'); } catch (e) { toast(`Ticket raised, but the file failed to upload: ${e.message}`, 'error'); return created; }
          }
          toast('Ticket raised — HR has been notified');
          return created;
        }}>
        {suggestions.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10" data-testid="kb-suggestions">
            <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300"><Lightbulb size={14} /> These articles might answer your question</div>
            {suggestions.map((a) => <button key={a.id} type="button" className="block text-left text-brand-700 hover:underline dark:text-brand-300" onClick={() => setArticle(a)}>{a.title}</button>)}
          </div>
        )}
        <FileDrop file={file} onChange={setFile} label="Screenshot or document (optional)" testId="ticket-drop" />
      </FormModal>
      <ArticleModal article={article} onClose={() => setArticle(null)} />
      <Drawer open={!!ticket} onClose={() => setOpen(null)} title={ticket ? `Ticket #${ticket.id}` : ''}>
        {ticket && (
          <div className="space-y-5">
            <div>
              <div className="flex gap-2"><Badge status={ticket.status} /><Badge status={ticket.priority} /><Badge color="slate">{ticket.category}</Badge></div>
              <h3 className="mt-3 text-lg font-bold">{ticket.subject}</h3>
              <div className="mt-2 flex items-center gap-2 text-sm muted"><Avatar name={ticket.employee_name} color={ticket.avatar_color} size="xs" />{ticket.employee_name} · {dateTime(ticket.created_at)}</div>
            </div>
            <p className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">{ticket.description}</p>
            <Attachments entity="tickets" entityId={ticket.id} related={['tickets']}
              canUpload={isHR || ((ticket.employee_id === user.id || ticket.assignee_id === user.id) && ['open', 'in_progress'].includes(ticket.status))} />
            {ticket.resolution && !isHR && <div className="rounded-xl bg-emerald-50 p-4 text-sm dark:bg-emerald-500/10"><div className="mb-1 flex items-center gap-1.5 font-semibold"><MessageSquare size={14} /> Resolution</div>{ticket.resolution}</div>}
            {isHR && (
              <div className="space-y-4 border-t border-slate-100 pt-4 dark:border-slate-800">
                <div><label className="label">Assignee</label><EmployeeSelect value={ticket.assignee_id} onChange={(v) => act(`tickets/${ticket.id}`, { method: 'PUT', body: { assignee_id: v }, success: 'Assignee updated' })} placeholder="Unassigned" filter={(e) => e.role !== 'employee'} /></div>
                <div><label className="label">Status</label>
                  <select className="input" value={ticket.status} onChange={(e) => act(`tickets/${ticket.id}`, { method: 'PUT', body: { status: e.target.value }, success: 'Status updated' })} data-testid="ticket-status">
                    {['open', 'in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select></div>
                <div><label className="label" htmlFor="resolution">Resolution note</label><textarea id="resolution" className="input min-h-24" value={resolution} onChange={(e) => setResolution(e.target.value)} /></div>
                <button className="btn-primary" onClick={() => act(`tickets/${ticket.id}`, { method: 'PUT', body: { resolution, status: 'resolved' }, success: 'Ticket resolved' })}>Resolve ticket</button>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

const STOP = new Set(['the', 'and', 'for', 'with', 'how', 'what', 'can', 'not', 'my', 'is', 'to', 'a', 'i', 'do', 'of', 'in', 'on', 'it', 'me', 'am', 'an', 'be']);
/** Rank articles by how many meaningful words of the query appear in their title/category/body. */
function suggest(articles, text) {
  const words = [...new Set(String(text).toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter((w) => !STOP.has(w));
  if (!words.length) return [];
  return articles.map((a) => {
    const title = `${a.title} ${a.category || ''}`.toLowerCase();
    const body = a.body.toLowerCase();
    return { a, score: words.reduce((n, w) => n + (title.includes(w) ? 3 : 0) + (body.includes(w) ? 1 : 0), 0) };
  }).filter((x) => x.score >= 2).sort((x, y) => y.score - x.score).slice(0, 3).map((x) => x.a);
}

function ArticleModal({ article, onClose, onEdit }) {
  const [act] = useAction();
  const [voted, setVoted] = useState(false);
  useEffect(() => { if (article) { setVoted(false); act(`kb/${article.id}/view`, { invalidates: [] }); } }, [article?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={!!article} onClose={onClose} title={article?.title || ''} size="lg"
      footer={article && <>
        {onEdit && <button className="btn-ghost mr-auto" onClick={() => onEdit(article)}><Pencil size={14} /> Edit</button>}
        <span className="text-sm muted">Was this helpful?</span>
        <button className="btn-secondary" disabled={voted} data-testid="kb-helpful" onClick={async () => { if (await act(`kb/${article.id}/helpful`, { success: 'Thanks for the feedback!' })) setVoted(true); }}><ThumbsUp size={14} /> {voted ? 'Thanks!' : 'Yes'}</button>
      </>}>
      {article && (
        <div data-testid="kb-article">
          <div className="mb-4 flex flex-wrap gap-2 text-xs muted">{article.category && <Badge color="violet">{article.category}</Badge>}<span>{article.author_name ? `By ${article.author_name} · ` : ''}updated {timeAgo(article.updated_at || article.created_at)}</span></div>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{article.body}</div>
        </div>
      )}
    </Modal>
  );
}

function KnowledgeBase() {
  const { isHR } = useAuth();
  const { data = [], isLoading } = useGet('kb');
  const [act] = useAction();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [article, setArticle] = useState(null);
  const [del, setDel] = useState(null);
  const form = useDisclosure();
  const cats = [...new Set(data.map((a) => a.category).filter(Boolean))].sort();
  const rows = useMemo(() => {
    const base = data.filter((a) => !cat || a.category === cat);
    if (!q.trim()) return base;
    const ranked = suggest(base, q);
    const plain = base.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(q.toLowerCase()) && !ranked.includes(a));
    return [...ranked, ...plain];
  }, [data, q, cat]);
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <Search size={18} className="ml-2 text-slate-400" />
        <input className="min-w-40 flex-1 bg-transparent py-2 text-sm outline-none" placeholder="Search policies, how-tos and FAQs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search knowledge base" data-testid="kb-search" />
        <select className="input !w-auto" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c}>{c}</option>)}</select>
        {isHR && <button className="btn-primary btn-sm" onClick={() => form.onOpen()} data-testid="new-article"><Plus size={14} /> New article</button>}
      </div>
      {isLoading ? <CardSkeleton lines={5} /> : rows.length === 0 ? <div className="card"><EmptyState icon={BookOpen} title="No articles found" message={q ? 'Try different words, or raise a ticket and HR will help.' : undefined} /></div> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((a) => (
            <div key={a.id} className="card flex flex-col p-5" data-testid="kb-card">
              <button className="text-left" onClick={() => setArticle(a)}>
                {a.category && <Badge color="violet">{a.category}</Badge>}
                <h3 className="mt-2 font-semibold hover:text-brand-600">{a.title}</h3>
                <p className="mt-1 line-clamp-3 text-sm muted">{a.body}</p>
              </button>
              <div className="mt-auto flex items-center gap-4 pt-4 text-xs muted">
                <span className="flex items-center gap-1"><Eye size={12} /> {a.views}</span><span className="flex items-center gap-1"><ThumbsUp size={12} /> {a.helpful}</span>
                {isHR && <span className="ml-auto flex gap-1"><button className="btn-ghost btn-sm !px-1.5" onClick={() => form.onOpen(a)} aria-label={`Edit ${a.title}`}><Pencil size={13} /></button><button className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" onClick={() => setDel(a)} aria-label={`Delete ${a.title}`}><Trash2 size={13} /></button></span>}
              </div>
            </div>
          ))}
        </div>
      )}
      <ArticleModal article={article} onClose={() => setArticle(null)} onEdit={isHR ? (a) => { setArticle(null); form.onOpen(a); } : undefined} />
      <FormModal open={form.open} onClose={form.onClose} size="lg" title={form.payload ? 'Edit article' : 'New article'} initial={form.payload || { category: 'HR' }}
        fields={[
          { name: 'title', label: 'Title', required: true, full: true },
          { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: ['HR', 'IT', 'Payroll', 'Leave', 'Benefits', 'Facilities', 'Finance', 'Policies'] },
          { name: 'body', label: 'Content', type: 'textarea', required: true, full: true },
        ]}
        onSubmit={(v) => (form.payload ? act(`kb/${form.payload.id}`, { method: 'PUT', body: { title: v.title, category: v.category, body: v.body }, success: 'Article updated' }) : act('kb', { body: v, success: 'Article published' }))} />
      <Confirm open={!!del} onClose={() => setDel(null)} danger title="Delete article?" confirmLabel="Delete" message={del?.title} onConfirm={() => act(`kb/${del.id}`, { method: 'DELETE', success: 'Article deleted' })} />
    </div>
  );
}

export default function Helpdesk() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'kb' ? 'kb' : 'tickets';
  return (
    <div>
      <PageHeader icon={LifeBuoy} title="Helpdesk" subtitle="Self-service answers and HR, IT, payroll and facilities requests" />
      <Tabs value={tab} onChange={(t) => setParams(t === 'kb' ? { tab: 'kb' } : {}, { replace: true })} tabs={[{ value: 'tickets', label: 'Tickets' }, { value: 'kb', label: 'Knowledge base' }]} />
      {tab === 'kb' ? <KnowledgeBase /> : <Tickets />}
    </div>
  );
}
