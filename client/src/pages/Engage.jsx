import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PartyPopper, Award, Plus, Pin, Trash2, Heart, MessageCircle, Send, Smile } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { useChartTheme } from '../lib/chart';
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
  const enps = useDisclosure();
  return (
    <div className="space-y-4">
      {isHR && <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => enps.onOpen()} data-testid="new-enps"><Smile size={16} /> New eNPS survey</button><button className="btn-primary" onClick={() => add.onOpen()}><Plus size={16} /> New poll</button></div>}
      {isLoading ? <CardSkeleton lines={4} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((p) => {
            if (p.type === 'enps') return <Enps key={p.id} p={p} />;
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
      <FormModal open={enps.open} onClose={enps.onClose} title="Launch eNPS survey" submitLabel="Launch" initial={{ question: 'How likely are you to recommend working here to a friend?' }}
        fields={[{ name: 'question', label: 'Question', required: true, full: true, hint: 'Employees answer 0–10 anonymously. eNPS = % promoters (9–10) − % detractors (0–6).' }]}
        onSubmit={(v) => act('surveys', { body: { question: v.question, type: 'enps' }, success: 'eNPS survey launched' })} />
    </div>
  );
}

function Enps({ p }) {
  const { isHR } = useAuth();
  const [act] = useAction();
  const chart = useChartTheme();
  const b = p.breakdown;
  const pct = (n) => (b.total ? Math.round((n / b.total) * 100) : 0);
  return (
    <div className="card card-pad md:col-span-2" data-testid="enps-survey">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><Badge color="violet">eNPS · anonymous</Badge><h3 className="mt-2 font-semibold">{p.question}</h3></div>
        {!p.active && <Badge color="slate">Closed</Badge>}
      </div>
      <div className="mt-4 grid grid-cols-11 gap-1.5" role="radiogroup" aria-label="Score from 0 to 10">
        {p.options.map((o, i) => (
          <button key={o} disabled={!p.active} role="radio" aria-checked={p.my_vote === i} data-testid={`enps-${i}`}
            onClick={() => act(`surveys/${p.id}/vote`, { body: { option_index: i }, success: 'Thanks — your response is anonymous' })}
            className={cx('rounded-lg border py-2 text-sm font-bold transition', p.my_vote === i ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 hover:border-brand-400 dark:border-slate-700')}>{o}</button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] muted"><span>Not likely</span><span>Extremely likely</span></div>
      {(isHR || p.my_vote !== null) && b.total > 0 && (
        <div className="mt-5 grid gap-4 sm:grid-cols-[auto,1fr] sm:items-center">
          <div className="text-center"><div className="text-4xl font-extrabold" data-testid="enps-score">{p.enps > 0 ? `+${p.enps}` : p.enps}</div><div className="text-xs muted">eNPS · {b.total} responses</div></div>
          <div>
            <div className="flex h-3 gap-0.5 overflow-hidden rounded-full">
              {[['promoters', 2], ['passives', 6], ['detractors', 7]].map(([k, c]) => <div key={k} style={{ width: `${pct(b[k])}%`, background: chart.series[c] }} title={`${k}: ${b[k]}`} />)}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs">
              {[['Promoters (9–10)', 'promoters', 2], ['Passives (7–8)', 'passives', 6], ['Detractors (0–6)', 'detractors', 7]].map(([l, k, c]) => <span key={k} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: chart.series[c] }} />{l}: <b>{pct(b[k])}%</b></span>)}
            </div>
          </div>
        </div>
      )}
      {isHR && <div className="mt-3 text-right"><button className="text-xs font-semibold text-brand-600" onClick={() => act(`surveys/${p.id}`, { method: 'PUT', body: { active: !p.active } })}>{p.active ? 'Close survey' : 'Reopen'}</button></div>}
    </div>
  );
}

function Post({ p }) {
  const { user, isHR } = useAuth();
  const [act] = useAction();
  const [comment, setComment] = useState('');
  const [showAll, setShowAll] = useState(false);
  const comments = showAll ? p.comments : p.comments.slice(-2);
  const render = (text) => text.split(/(@[A-Z][a-z]+ [A-Z][a-z]+)/g).map((part, i) => (part.startsWith('@') ? <span key={i} className="font-semibold text-brand-600">{part}</span> : part));
  return (
    <div className="card card-pad" data-testid="post">
      <div className="flex items-center gap-3">
        <Avatar name={p.author_name} color={p.avatar_color} />
        <div className="min-w-0 flex-1"><div className="font-semibold">{p.author_name}</div><div className="text-xs muted">{p.designation} · {timeAgo(p.created_at)}</div></div>
        {(p.author_id === user.id || isHR) && <button className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" onClick={() => act(`people/posts/${p.id}`, { method: 'DELETE', success: 'Post deleted' })} aria-label="Delete post"><Trash2 size={15} /></button>}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{render(p.body)}</p>
      <div className="mt-3 flex items-center gap-4 border-t border-slate-100 pt-3 text-sm dark:border-slate-800">
        <button className={cx('flex items-center gap-1.5 font-semibold transition', p.liked ? 'text-rose-600' : 'text-slate-500 hover:text-rose-500')} onClick={() => act(`people/posts/${p.id}/like`, { invalidates: ['people'] })} data-testid="like-post" aria-pressed={p.liked}>
          <Heart size={16} className={p.liked ? 'fill-current' : ''} /> {p.likes}
        </button>
        <span className="flex items-center gap-1.5 text-slate-500"><MessageCircle size={16} /> {p.comment_count}</span>
      </div>
      {p.comments.length > 2 && !showAll && <button className="mt-2 text-xs font-semibold text-brand-600" onClick={() => setShowAll(true)}>View all {p.comments.length} comments</button>}
      <div className="mt-2 space-y-2">
        {comments.map((c) => (
          <div key={c.id} className="flex gap-2" data-testid="comment">
            <Avatar name={c.author_name} color={c.avatar_color} size="xs" />
            <div className="group min-w-0 flex-1 rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
              <div className="flex items-center justify-between"><b className="text-xs">{c.author_name}</b>{(c.author_id === user.id || isHR) && <button className="opacity-0 transition group-hover:opacity-100" onClick={() => act(`people/comments/${c.id}`, { method: 'DELETE' })} aria-label="Delete comment"><Trash2 size={12} /></button>}</div>
              {render(c.body)}
            </div>
          </div>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (comment.trim() && await act(`people/posts/${p.id}/comments`, { body: { body: comment } })) setComment(''); }}>
        <input className="input !py-1.5 text-sm" placeholder="Write a comment…" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" maxLength={1000} />
        <button className="btn-secondary btn-sm" disabled={!comment.trim()} aria-label="Send comment" data-testid="send-comment"><Send size={14} /></button>
      </form>
    </div>
  );
}

function Feed() {
  const { user } = useAuth();
  const { data = [], isLoading } = useGet('people/posts');
  const [act, { isLoading: posting }] = useAction();
  const [body, setBody] = useState('');
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <form className="card card-pad" onSubmit={async (e) => { e.preventDefault(); if (await act('people/posts', { body: { body }, success: 'Posted' })) setBody(''); }}>
        <div className="flex gap-3">
          <Avatar name={`${user.first_name} ${user.last_name}`} color={user.avatar_color} />
          <textarea className="input min-h-20 flex-1" placeholder="Share an update, a win or a thank-you… mention people with @First Last" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} aria-label="New post" data-testid="post-body" />
        </div>
        <div className="mt-3 flex items-center justify-between"><span className="text-xs muted">{body.length}/2000</span><button className="btn-primary btn-sm" disabled={!body.trim() || posting} data-testid="publish-post"><Send size={14} /> Post</button></div>
      </form>
      {isLoading ? <CardSkeleton lines={4} /> : data.length === 0 ? <div className="card"><EmptyState icon={MessageCircle} title="No posts yet" message="Be the first to share something with the company." /></div> : data.map((p) => <Post key={p.id} p={p} />)}
    </div>
  );
}

const ENGAGE_TABS = [{ value: 'announcements', label: 'Announcements' }, { value: 'feed', label: 'Feed' }, { value: 'kudos', label: 'Kudos wall' }, { value: 'polls', label: 'Polls & eNPS' }];

export default function Engage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('kudos') ? 'kudos' : ENGAGE_TABS.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'announcements';
  return (
    <div>
      <PageHeader icon={PartyPopper} title="Engage" subtitle="Announcements, social feed, recognition, polls and eNPS" />
      <Tabs value={tab} onChange={(t) => setParams(t === 'announcements' ? {} : { tab: t }, { replace: true })} tabs={ENGAGE_TABS} />
      {tab === 'announcements' && <Announcements />}
      {tab === 'feed' && <Feed />}
      {tab === 'kudos' && <Kudos autoOpen={!!params.get('kudos')} />}
      {tab === 'polls' && <Polls />}
    </div>
  );
}
