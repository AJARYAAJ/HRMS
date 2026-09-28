import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PartyPopper, Award, Plus, Pin, Trash2 } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Tabs, Avatar, Badge, CardSkeleton, EmptyState, cx } from '../components/ui';
import { FormModal } from '../components/Form';
import { timeAgo } from '../lib/format';

const BADGES = ['🌟 Star Performer', '🤝 Team Player', '🚀 Go-Getter', '💡 Innovator', '🎯 Customer Hero', '🙏 Thank You'];

function Announcements() {
  const { isHR } = useAuth();
  const { data = [], isLoading } = useGet('announcements');
  const [act] = useAction();
  const add = useDisclosure();
  return (
    <div className="space-y-4">
      {isHR && <div className="flex justify-end"><button className="btn-primary" onClick={() => add.onOpen()} data-testid="new-announcement"><Plus size={16} /> Post announcement</button></div>}
      {isLoading ? <CardSkeleton lines={5} /> : data.map((a) => (
        <article key={a.id} className="card card-pad" data-testid="announcement">
          <div className="flex items-start gap-3">
            <Avatar name={a.author_name} color={a.avatar_color} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm"><b>{a.author_name}</b><span className="muted">· {timeAgo(a.created_at)}</span>{a.pinned ? <Badge color="violet"><Pin size={10} /> Pinned</Badge> : null}<Badge color="slate">{a.category}</Badge></div>
              <h3 className="mt-2 text-lg font-bold">{a.title}</h3>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-300">{a.body}</p>
            </div>
            {isHR && (
              <div className="flex gap-1">
                <button className="btn-ghost btn-sm !px-1.5" aria-label="Toggle pin" onClick={() => act(`announcements/${a.id}`, { method: 'PUT', body: { pinned: a.pinned ? 0 : 1 } })}><Pin size={14} /></button>
                <button className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" aria-label="Delete" onClick={() => act(`announcements/${a.id}`, { method: 'DELETE', success: 'Announcement removed' })}><Trash2 size={14} /></button>
              </div>
            )}
          </div>
        </article>
      ))}
      <FormModal open={add.open} onClose={add.onClose} title="New announcement" initial={{ category: 'General', pinned: 0 }} submitLabel="Publish"
        fields={[{ name: 'title', label: 'Title', required: true, full: true }, { name: 'category', label: 'Category', type: 'select', noEmpty: true, options: ['General', 'Policy', 'Events', 'Performance', 'IT'] },
          { name: 'pinned', label: 'Pin to top', type: 'checkbox' }, { name: 'body', label: 'Message', type: 'textarea', required: true, full: true }]}
        onSubmit={(v) => act('announcements', { body: v, success: 'Announcement published to everyone' })} />
    </div>
  );
}

function Kudos({ autoOpen }) {
  const { data = [], isLoading } = useGet('kudos');
  const [act] = useAction();
  const give = useDisclosure(autoOpen);
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn-primary" onClick={() => give.onOpen()} data-testid="give-kudos"><Award size={16} /> Give kudos</button></div>
      {isLoading ? <CardSkeleton lines={4} /> : data.length === 0 ? <div className="card"><EmptyState icon={Award} title="No kudos yet" /></div> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.map((k) => (
            <div key={k.id} className="card relative overflow-hidden p-5" data-testid="kudos-card">
              <div className="absolute -right-6 -top-6 text-7xl opacity-10">{k.badge?.split(' ')[0]}</div>
              <div className="text-sm font-bold text-amber-600 dark:text-amber-400">{k.badge}</div>
              <p className="mt-2 text-sm">“{k.message}”</p>
              <div className="mt-4 flex items-center gap-2 text-xs">
                <Avatar name={k.from_name} color={k.from_color} size="xs" /><span className="font-semibold">{k.from_name}</span><span className="muted">→</span>
                <Avatar name={k.to_name} color={k.to_color} size="xs" /><span className="font-semibold">{k.to_name}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400">{timeAgo(k.created_at)}</div>
            </div>
          ))}
        </div>
      )}
      <FormModal open={give.open} onClose={give.onClose} title="Appreciate a colleague 🎉" submitLabel="Send kudos" initial={{ badge: BADGES[0] }}
        fields={[{ name: 'to_id', label: 'Colleague', type: 'employee', required: true, full: true }, { name: 'badge', label: 'Badge', type: 'select', noEmpty: true, options: BADGES, full: true },
          { name: 'message', label: 'Message', type: 'textarea', required: true, full: true, placeholder: 'What did they do that made a difference?' }]}
        onSubmit={(v) => act('kudos', { body: v, success: 'Kudos sent! 🎉' })} />
    </div>
  );
}

function Polls() {
  const { isHR } = useAuth();
  const { data = [], isLoading } = useGet('surveys');
  const [act] = useAction();
  const add = useDisclosure();
  return (
    <div className="space-y-4">
      {isHR && <div className="flex justify-end"><button className="btn-primary" onClick={() => add.onOpen()}><Plus size={16} /> New poll</button></div>}
      {isLoading ? <CardSkeleton lines={4} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((p) => {
            const total = p.counts.reduce((a, b) => a + b, 0);
            return (
              <div key={p.id} className="card card-pad" data-testid="poll">
                <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{p.question}</h3>{!p.active && <Badge color="slate">Closed</Badge>}</div>
                <div className="mt-4 space-y-2">
                  {p.options.map((o, i) => {
                    const pct = total ? Math.round((p.counts[i] / total) * 100) : 0;
                    const mine = p.my_vote === i;
                    return (
                      <button key={o} disabled={!p.active} onClick={() => act(`surveys/${p.id}/vote`, { body: { option_index: i }, success: 'Vote recorded' })}
                        className={cx('relative w-full overflow-hidden rounded-xl border px-3 py-2.5 text-left text-sm transition', mine ? 'border-brand-500' : 'border-slate-200 hover:border-brand-300 dark:border-slate-700')}>
                        <div className={cx('absolute inset-y-0 left-0 transition-all', mine ? 'bg-brand-500/15' : 'bg-slate-100 dark:bg-slate-800')} style={{ width: p.my_vote !== null ? `${pct}%` : 0 }} />
                        <span className="relative flex justify-between font-medium"><span>{o}{mine && ' ✓'}</span>{p.my_vote !== null && <span className="muted">{pct}%</span>}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs muted"><span>{total} votes</span>
                  {isHR && <button className="font-semibold text-brand-600" onClick={() => act(`surveys/${p.id}`, { method: 'PUT', body: { active: !p.active } })}>{p.active ? 'Close poll' : 'Reopen'}</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <FormModal open={add.open} onClose={add.onClose} title="Create poll"
        fields={[{ name: 'question', label: 'Question', required: true, full: true }, { name: 'options', label: 'Options (one per line)', type: 'textarea', required: true, full: true }]}
        onSubmit={(v) => act('surveys', { body: { question: v.question, options: String(v.options || '').split('\n') }, success: 'Poll published' })} />
    </div>
  );
}

export default function Engage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('kudos') ? 'kudos' : 'feed');
  useEffect(() => { if (params.get('kudos')) setTab('kudos'); }, [params]);
  return (
    <div>
      <PageHeader icon={PartyPopper} title="Engage" subtitle="Announcements, recognition and pulse polls" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'feed', label: 'Announcements' }, { value: 'kudos', label: 'Kudos wall' }, { value: 'polls', label: 'Polls' }]} />
      {tab === 'feed' && <Announcements />}
      {tab === 'kudos' && <Kudos autoOpen={!!params.get('kudos')} />}
      {tab === 'polls' && <Polls />}
    </div>
  );
}
