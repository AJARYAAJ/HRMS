import { Plus, Pencil, Trash2 } from 'lucide-react';
import { useGet, useAction, useDisclosure } from '../lib/hooks';
import { Confirm } from './ui';
import DataTable from './DataTable';
import { FormModal } from './Form';
import { useState } from 'react';

/** Generic list + create/edit/delete for simple master data. */
export default function CrudTable({ path, label, columns, fields, searchKeys, defaults = {}, canEdit = true }) {
  const { data = [], isLoading } = useGet(path);
  const [act] = useAction();
  const form = useDisclosure();
  const [del, setDel] = useState(null);
  return (
    <>
      <DataTable loading={isLoading} rows={data} searchKeys={searchKeys} exportName={path.replace('/', '-')} maxHeight="calc(100vh - 340px)"
        toolbar={canEdit && <button className="btn-primary btn-sm" onClick={() => form.onOpen()} data-testid={`add-${path}`}><Plus size={14} /> Add {label}</button>}
        columns={[...columns, ...(canEdit ? [{ key: '_a', header: '', sortable: false, csv: false, width: '100px', render: (r) => (
          <div className="flex justify-end gap-1">
            <button className="btn-ghost btn-sm !px-1.5" onClick={() => form.onOpen(r)} aria-label={`Edit ${label}`}><Pencil size={14} /></button>
            <button className="btn-ghost btn-sm !px-1.5 hover:text-rose-500" onClick={() => setDel(r)} aria-label={`Delete ${label}`}><Trash2 size={14} /></button>
          </div>
        ) }] : [])]} />
      <FormModal open={form.open} onClose={form.onClose} title={form.payload ? `Edit ${label}` : `Add ${label}`} fields={fields} initial={form.payload || defaults}
        onSubmit={(v) => (form.payload ? act(`${path}/${form.payload.id}`, { method: 'PUT', body: v, success: `${label} updated` }) : act(path, { body: v, success: `${label} added` }))} />
      <Confirm open={!!del} onClose={() => setDel(null)} danger confirmLabel="Delete" title={`Delete ${label}?`} message="This cannot be undone."
        onConfirm={() => act(`${path}/${del.id}`, { method: 'DELETE', success: `${label} deleted` })} />
    </>
  );
}
