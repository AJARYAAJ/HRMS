import { useState } from 'react';
import { FileText, Plus, Trash2, BookOpen, User, Search } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, CardSkeleton, EmptyState, Modal } from '../components/ui';
import { FormModal } from '../components/Form';
import { date } from '../lib/format';

export default function Documents() {
  const { isHR } = useAuth();
  const { data = [], isLoading } = useGet('documents');
  const [act] = useAction();
  const add = useDisclosure();
  const [view, setView] = useState(null);
  const [q, setQ] = useState('');
  const filtered = data.filter((d) => !q || `${d.title} ${d.category}`.toLowerCase().includes(q.toLowerCase()));
  const company = filtered.filter((d) => !d.employee_id);
  const personal = filtered.filter((d) => d.employee_id);

  const Card = ({ d }) => (
    <div className="card group flex cursor-pointer items-start gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => setView(d)}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white"><FileText size={18} /></div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{d.title}</div>
        <div className="mt-0.5 line-clamp-2 text-xs muted">{d.content}</div>
        <div className="mt-2 flex items-center gap-2"><Badge color="slate">{d.category}</Badge><span className="text-[11px] text-slate-400">{date(d.created_at)}</span></div>
      </div>
      {isHR && <button className="opacity-0 transition group-hover:opacity-100 text-slate-400 hover:text-rose-500" aria-label="Delete document" onClick={(e) => { e.stopPropagation(); act(`documents/${d.id}`, { method: 'DELETE', success: 'Document deleted' }); }}><Trash2 size={15} /></button>}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader icon={FileText} title="Documents" subtitle="Company policies and your personal documents"
        actions={<>
          <div className="relative"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input w-56 pl-9" placeholder="Search documents…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search documents" /></div>
          {isHR && <button className="btn-primary" onClick={() => add.onOpen()}><Plus size={16} /> Upload</button>}
        </>} />
      {isLoading ? <CardSkeleton lines={5} /> : (
        <>
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><BookOpen size={16} className="text-brand-500" /> Company policies</h2>
            {company.length === 0 ? <div className="card"><EmptyState title="No policies found" /></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{company.map((d) => <Card key={d.id} d={d} />)}</div>}
          </section>
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><User size={16} className="text-brand-500" /> My documents</h2>
            {personal.length === 0 ? <div className="card"><EmptyState title="No personal documents" message="Offer letters, appraisal letters and certificates shared by HR appear here." /></div> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{personal.map((d) => <Card key={d.id} d={d} />)}</div>}
          </section>
        </>
      )}
      <Modal open={!!view} onClose={() => setView(null)} title={view?.title} size="lg">
        <Badge color="slate">{view?.category}</Badge>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">{view?.content}</p>
      </Modal>
      <FormModal open={add.open} onClose={add.onClose} title="Add document" initial={{ category: 'Policy' }}
        fields={[
          { name: 'title', label: 'Title', required: true, full: true },
          { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: ['Policy', 'Compliance', 'Calendar', 'Personal', 'Letter', 'Form'] },
          { name: 'employee_id', label: 'Share with employee (leave empty for company-wide)', type: 'employee' },
          { name: 'content', label: 'Content', type: 'textarea', full: true, required: true },
        ]}
        onSubmit={(v) => act('documents', { body: v, success: 'Document published' })} />
    </div>
  );
}
