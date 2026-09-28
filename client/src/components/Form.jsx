import { useEffect, useRef, useState } from 'react';
import { useGet } from '../lib/hooks';
import { cx, Modal } from './ui';

/** Select populated from the cached employee directory. */
export function EmployeeSelect({ value, onChange, placeholder = 'Select employee', required, name, id, includeEmpty = true, filter }) {
  const { data = [], isLoading } = useGet('employees');
  const options = filter ? data.filter(filter) : data;
  return (
    <select className="input" id={id} name={name} value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={isLoading}>
      {includeEmpty && <option value="">{isLoading ? 'Loading…' : placeholder}</option>}
      {options.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name} · {e.emp_code}</option>)}
    </select>
  );
}

/** Select populated from any cached lookup endpoint (departments, projects, …). */
export function LookupSelect({ path, labelKey = 'name', value, onChange, placeholder = 'Select', required, id, name }) {
  const { data = [], isLoading } = useGet(path);
  return (
    <select className="input" id={id} name={name} value={value ?? ''} required={required} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{isLoading ? 'Loading…' : placeholder}</option>
      {data.map((o) => <option key={o.id} value={o.id}>{typeof labelKey === 'function' ? labelKey(o) : o[labelKey]}</option>)}
    </select>
  );
}

export function Field({ field, value, onChange }) {
  const id = `f-${field.name}`;
  const common = { id, name: field.name, required: field.required, placeholder: field.placeholder };
  let control;
  switch (field.type) {
    case 'textarea':
      control = <textarea className="input min-h-24" {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'select':
      control = (
        <select className="input" {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
          {!field.noEmpty && <option value="">{field.placeholder || 'Select'}</option>}
          {field.options.map((o) => {
            const [v, l] = Array.isArray(o) ? o : typeof o === 'object' ? [o.value, o.label] : [o, o];
            return <option key={v} value={v}>{l}</option>;
          })}
        </select>
      );
      break;
    case 'employee':
      control = <EmployeeSelect {...common} value={value} onChange={onChange} filter={field.filter} />;
      break;
    case 'lookup':
      control = <LookupSelect {...common} path={field.path} labelKey={field.labelKey} value={value} onChange={onChange} />;
      break;
    case 'checkbox':
      return (
        <label className={cx('flex items-center gap-2.5 text-sm font-medium', field.full && 'sm:col-span-2')}>
          <input type="checkbox" id={id} className="h-4 w-4 rounded accent-brand-600" checked={!!value} onChange={(e) => onChange(e.target.checked ? 1 : 0)} />
          {field.label}
        </label>
      );
    default:
      control = (
        <input className="input" type={field.type || 'text'} {...common} min={field.min} max={field.max} step={field.step}
          value={value ?? ''} onChange={(e) => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
      );
  }
  return (
    <div className={cx(field.full && 'sm:col-span-2')}>
      <label htmlFor={id} className="label">{field.label}{field.required && <span className="text-rose-500"> *</span>}</label>
      {control}
      {field.hint && <p className="mt-1 text-xs text-slate-400">{field.hint}</p>}
    </div>
  );
}

/** Declarative form rendered from a field config. */
export function FormFields({ fields, values, setValues }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.filter((f) => !f.hidden?.(values)).map((f) => (
        <Field key={f.name} field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
      ))}
    </div>
  );
}

/** Modal wrapping a declarative form. onSubmit(values) should resolve truthy to close. */
export function FormModal({ open, onClose, title, fields, initial, onSubmit, submitLabel = 'Save', size = 'md', children }) {
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  // Initialise only when the dialog opens; parents pass a fresh `initial` object on every render,
  // so depending on it would wipe what the user has typed whenever a background refetch re-renders.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setValues(initial || {});
    wasOpen.current = open;
  }, [open, initial]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok = await onSubmit(values);
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={title} size={size}>
      <form onSubmit={submit} className="space-y-5">
        {children}
        <FormFields fields={fields} values={values} setValues={setValues} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}
