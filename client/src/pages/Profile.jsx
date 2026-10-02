import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { UserCircle, KeyRound, Save, Moon, Sun, Mail } from 'lucide-react';
import { useGet, useAction } from '../lib/hooks';
import { PageHeader, CardSkeleton } from '../components/ui';
import { FormFields } from '../components/Form';
import { updateUser } from '../store/authSlice';
import { toggleTheme } from '../store/uiSlice';
import { PushSettings } from '../components/PushNotifications';

const FIELDS = [
  { name: 'phone', label: 'Phone' }, { name: 'blood_group', label: 'Blood group', type: 'select', options: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'] },
  { name: 'marital_status', label: 'Marital status', type: 'select', options: ['Single', 'Married', 'Divorced', 'Widowed'] }, { name: 'emergency_contact', label: 'Emergency contact' },
  { name: 'bank_name', label: 'Bank name' }, { name: 'bank_account', label: 'Account number' }, { name: 'ifsc', label: 'IFSC' },
  { name: 'address', label: 'Address', type: 'textarea', full: true },
];

export default function Profile() {
  const { data, isLoading } = useGet('auth/me');
  const [values, setValues] = useState({});
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [emailPref, setEmailPref] = useState(null);
  const [act] = useAction();
  const dispatch = useDispatch();
  useEffect(() => { if (data) setValues(data); }, [data]);

  const saveProfile = async (e) => {
    e.preventDefault();
    const res = await act('auth/profile', { method: 'PUT', body: values, success: 'Profile updated', invalidates: ['employees'] });
    if (res) dispatch(updateUser({ phone: res.phone }));
  };
  const changePw = async (e) => {
    e.preventDefault();
    setPwError('');
    if (pw.new_password !== pw.confirm) return setPwError('Passwords do not match');
    if (await act('auth/change-password', { body: pw, success: 'Password changed' })) setPw({ current_password: '', new_password: '', confirm: '' });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader icon={UserCircle} title="Account settings" subtitle="Update your personal details, bank information and password" />
      {isLoading ? <CardSkeleton lines={6} /> : (
        <form className="card card-pad space-y-5" onSubmit={saveProfile}>
          <h3 className="font-semibold">Personal & bank details</h3>
          <FormFields fields={FIELDS} values={values} setValues={setValues} />
          <div className="flex justify-end"><button className="btn-primary" data-testid="save-profile"><Save size={16} /> Save</button></div>
        </form>
      )}
      <form className="card card-pad space-y-4" onSubmit={changePw}>
        <h3 className="flex items-center gap-2 font-semibold"><KeyRound size={16} className="text-brand-500" /> Change password</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {[['current_password', 'Current password'], ['new_password', 'New password'], ['confirm', 'Confirm new password']].map(([k, l]) => (
            <div key={k}><label className="label" htmlFor={k}>{l}</label><input id={k} type="password" className="input" required minLength={k === 'current_password' ? 1 : 8} value={pw[k]} onChange={(e) => setPw((p) => ({ ...p, [k]: e.target.value }))} /></div>
          ))}
        </div>
        {pwError && <p className="text-sm text-rose-600">{pwError}</p>}
        <div className="flex justify-end"><button className="btn-primary">Update password</button></div>
      </form>
      {data && (
        <div className="card card-pad flex items-center justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 font-semibold"><Mail size={16} className="text-brand-500" /> Email notifications</h3>
            <p className="text-sm muted">Get an email for approvals, payslips, kudos and other updates. Security emails (password resets) are always sent.</p>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input type="checkbox" className="peer sr-only" aria-label="Email notifications" data-testid="email-pref"
              checked={emailPref ?? !!data.email_notifications}
              onChange={async (e) => {
                const on = e.target.checked;
                setEmailPref(on); // optimistic: flip immediately, roll back if the save fails
                const ok = await act('auth/profile', { method: 'PUT', body: { email_notifications: on }, success: on ? 'Email notifications on' : 'Email notifications off', invalidates: ['auth'] });
                if (!ok) setEmailPref(!on);
              }} />
            <span className="h-6 w-11 rounded-full bg-slate-200 transition peer-checked:bg-brand-600 dark:bg-slate-700" />
            <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
          </label>
        </div>
      )}
      <PushSettings />
      <div className="card card-pad flex items-center justify-between">
        <div><h3 className="font-semibold">Appearance</h3><p className="text-sm muted">Switch between light and dark theme.</p></div>
        <button className="btn-secondary" onClick={() => dispatch(toggleTheme())}><Moon size={16} className="dark:hidden" /><Sun size={16} className="hidden dark:block" /> Toggle theme</button>
      </div>
    </div>
  );
}
