import { GraduationCap, Plus, Clock, Award, PlayCircle, CheckCircle2 } from 'lucide-react';
import { useGet, useAction, useAuth, useDisclosure } from '../lib/hooks';
import { PageHeader, Badge, Progress, CardSkeleton, StatCard } from '../components/ui';
import { FormModal } from '../components/Form';

export default function Learning() {
  const { isHR, user } = useAuth();
  const { data: courses = [], isLoading } = useGet('courses');
  const { data: mine = [], isLoading: mLoading } = useGet('enrollments', { mine: 1 });
  const [act] = useAction();
  const add = useDisclosure();
  const byCourse = Object.fromEntries(mine.map((e) => [e.course_id, e]));
  const completed = mine.filter((e) => e.status === 'completed').length;

  return (
    <div className="space-y-6">
      <PageHeader icon={GraduationCap} title="Learning & development" subtitle="Mandatory compliance training and self-paced courses"
        actions={isHR && <button className="btn-primary" onClick={() => add.onOpen()}><Plus size={16} /> New course</button>} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={PlayCircle} label="Enrolled" value={mine.length} />
        <StatCard icon={CheckCircle2} tone="green" label="Completed" value={completed} />
        <StatCard icon={Award} tone="amber" label="Learning hours" value={`${mine.filter((e) => e.status === 'completed').reduce((a, e) => a + (e.duration_hours || 0), 0)}h`} />
      </div>
      {isLoading || mLoading ? <CardSkeleton lines={6} /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((c) => {
            const e = byCourse[c.id];
            return (
              <div key={c.id} className="card flex flex-col overflow-hidden" data-testid="course-card">
                <div className="h-2 bg-gradient-to-r from-brand-500 to-violet-500" />
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-center gap-2"><Badge color="slate">{c.category}</Badge>{c.mandatory ? <Badge color="red">Mandatory</Badge> : null}</div>
                  <h3 className="mt-3 font-semibold">{c.title}</h3>
                  <p className="mt-1 flex-1 text-sm muted">{c.description}</p>
                  <div className="mt-3 flex items-center gap-3 text-xs muted"><span className="flex items-center gap-1"><Clock size={12} />{c.duration_hours}h</span><span>{c.enrolled} enrolled · {c.completed} completed</span></div>
                  <div className="mt-4">
                    {!e ? (
                      <button className="btn-primary w-full" onClick={() => act('enrollments', { body: { course_id: c.id, employee_id: user.id }, success: 'Enrolled — happy learning!' })}>Enroll</button>
                    ) : e.status === 'completed' ? (
                      <div className="flex items-center justify-center gap-2 rounded-xl bg-emerald-50 py-2 text-sm font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"><Award size={16} /> Completed</div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs"><span className="muted">Progress</span><span className="font-semibold">{e.progress}%</span></div>
                        <Progress value={e.progress} />
                        <button className="btn-secondary w-full" onClick={() => act(`enrollments/${e.id}`, { method: 'PUT', body: { progress: Math.min(100, e.progress + 25) }, success: e.progress + 25 >= 100 ? 'Course completed! 🎓' : 'Progress saved' })}>
                          <PlayCircle size={16} /> {e.progress ? 'Continue' : 'Start'} learning
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <FormModal open={add.open} onClose={add.onClose} title="New course" initial={{ mandatory: 0 }}
        fields={[{ name: 'title', label: 'Title', required: true, full: true }, { name: 'category', label: 'Category', type: 'select', options: ['Compliance', 'Technical', 'Leadership', 'Soft Skills', 'Sales'] },
          { name: 'duration_hours', label: 'Duration (hours)', type: 'number', min: 0 }, { name: 'mandatory', label: 'Mandatory for all', type: 'checkbox' },
          { name: 'description', label: 'Description', type: 'textarea', full: true }]}
        onSubmit={(v) => act('courses', { body: v, success: 'Course published' })} />
    </div>
  );
}
