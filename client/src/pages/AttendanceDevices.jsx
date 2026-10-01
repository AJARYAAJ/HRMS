import { useState } from 'react';
import { Fingerprint, Plus, KeyRound, Trash2, Link2, Copy, Power } from 'lucide-react';
import { useGet, useAction, useDisclosure, useToast } from '../lib/hooks';
import { PageHeader, Badge, Tabs, Modal, Avatar, EmptyState } from '../components/ui';
import DataTable from '../components/DataTable';
import { FormModal } from '../components/Form';
import { dateTime, timeAgo, todayStr } from '../lib/format';

function KeyModal({ info, onClose }) {
  const toast = useToast();
  if (!info) return null;
  const host = window.location.host;
  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('Copied'));
  return (
    <Modal open={!!info} onClose={onClose} title="Connect the device" size="lg" footer={<button className="btn-primary" onClick={onClose}>Done</button>}>
      <div className="space-y-4 text-sm">
        <div>
          <h4 className="font-semibold">ZKTeco / eSSL / other ADMS (push) devices</h4>
          <p className="muted">On the device: Menu → Comm. → Cloud Server Setting (ADMS). Use the serial number registered here.</p>
          <ul className="mt-2 space-y-1">
            <li>Server address: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{window.location.hostname}</code></li>
            <li>Server port: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{window.location.port || (window.location.protocol === 'https:' ? '443' : '80')}</code> · HTTPS: {window.location.protocol === 'https:' ? 'on' : 'off'}</li>
            <li>Device serial number: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{info.serial_no}</code></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold">Any other device or a sync bridge (JSON API)</h4>
          <p className="muted">Send punches with this device key. It is shown only once — store it safely.</p>
          <div className="mt-2 flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded-lg bg-slate-100 px-2 py-1.5 text-xs dark:bg-slate-800" data-testid="device-key">{info.key}</code><button className="btn-secondary btn-sm" onClick={() => copy(info.key)}><Copy size={14} /> Copy</button></div>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-3 text-[11px] text-slate-100">{`curl -X POST ${window.location.protocol}//${host}/api/biometric/punches \\
  -H "X-Device-Key: ${info.key}" -H "Content-Type: application/json" \\
  -d '{"punches":[{"user_id":"1004","time":"${todayStr()} 09:30:00","direction":"in"}]}'`}</pre>
        </div>
        <p className="text-xs muted">Set each employee's device user ID on their profile (Edit → Biometric device user ID), or map unknown IDs from the Unmatched punches tab.</p>
      </div>
    </Modal>
  );
}

export default function AttendanceDevices() {
  const [tab, setTab] = useState('devices');
  const [date, setDate] = useState(todayStr());
  const { data: devices = [], isLoading } = useGet('attendance-devices/devices');
  const { data: punches = [], isLoading: pLoading } = useGet(tab === 'devices' ? null : 'attendance-devices/punches', tab === 'unmatched' ? { unmatched: 1 } : { date });
  const [act] = useAction();
  const add = useDisclosure();
  const map = useDisclosure();
  const [keyInfo, setKeyInfo] = useState(null);
  const unmatched = devices.reduce((a, d) => a + d.unmatched, 0);
  const online = (d) => d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 15 * 60_000;
  return (
    <div className="space-y-6">
      <PageHeader icon={Fingerprint} title="Attendance devices" subtitle="Biometric and card terminals that mark attendance — fingerprint, face or card punches become clock-in and clock-out"
        actions={<button className="btn-primary" onClick={() => add.onOpen()} data-testid="add-device"><Plus size={16} /> Add device</button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'devices', label: 'Devices' }, { value: 'log', label: 'Punch log' }, { value: 'unmatched', label: 'Unmatched punches', count: unmatched || undefined }]} />
      {tab === 'devices' && (
        <DataTable loading={isLoading} rows={devices} searchKeys={['name', 'serial_no', 'location']} testId="devices-table"
          empty={<EmptyState icon={Fingerprint} title="No devices yet" message="Add your office's biometric terminal to start receiving punches." />}
          columns={[
            { key: 'name', header: 'Device', render: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs muted">SN {r.serial_no} · key {r.key_prefix}…</div></div> },
            { key: 'location', header: 'Location', render: (r) => r.location || '—' },
            { key: 'status', header: 'Status', render: (r) => (!r.active ? <Badge color="slate">Disabled</Badge> : online(r) ? <Badge color="green">Online</Badge> : <Badge color="amber">{r.last_seen_at ? `Seen ${timeAgo(r.last_seen_at)}` : 'Never connected'}</Badge>) },
            { key: 'punches', header: 'Punches', align: 'right' },
            { key: 'unmatched', header: 'Unmatched', align: 'right', render: (r) => (r.unmatched ? <Badge color="amber">{r.unmatched}</Badge> : 0) },
            { key: 'act', header: '', sortable: false, render: (r) => (
              <div className="flex justify-end gap-1">
                <button className="btn-ghost btn-sm" aria-label={`New key for ${r.name}`} onClick={async () => { const k = await act(`attendance-devices/devices/${r.id}/rotate-key`, { body: {}, success: 'New key generated' }); if (k?.key) setKeyInfo({ key: k.key, serial_no: r.serial_no }); }}><KeyRound size={14} /></button>
                <button className="btn-ghost btn-sm" aria-label={`${r.active ? 'Disable' : 'Enable'} ${r.name}`} onClick={() => act(`attendance-devices/devices/${r.id}`, { method: 'PUT', body: { active: !r.active }, success: r.active ? 'Device disabled' : 'Device enabled' })}><Power size={14} /></button>
                <button className="btn-ghost btn-sm text-rose-600" aria-label={`Delete ${r.name}`} onClick={() => act(`attendance-devices/devices/${r.id}`, { method: 'DELETE', success: 'Device removed' })}><Trash2 size={14} /></button>
              </div>
            ) },
          ]} />
      )}
      {tab !== 'devices' && (
        <DataTable loading={pLoading} rows={punches} searchKeys={['biometric_id', 'employee_name', 'device']} testId="punch-table"
          toolbar={tab === 'log' && <input type="date" className="input !w-auto" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Punch date" />}
          empty={<EmptyState icon={Fingerprint} title={tab === 'unmatched' ? 'No unmatched punches' : 'No punches on this day'} />}
          columns={[
            { key: 'punched_at', header: 'Time', render: (r) => dateTime(r.punched_at.replace(' ', 'T')) },
            { key: 'biometric_id', header: 'Device user ID', render: (r) => <code className="text-xs">{r.biometric_id}</code> },
            { key: 'employee_name', header: 'Employee', render: (r) => (r.employee_name ? <div className="flex items-center gap-2"><Avatar name={r.employee_name} color={r.avatar_color} size="xs" />{r.employee_name}</div> : <Badge color="amber">Not matched</Badge>) },
            { key: 'device', header: 'Device' },
            { key: 'verify', header: 'Method', render: (r) => r.verify || '—' },
            { key: 'direction', header: 'In / out', render: (r) => r.direction || '—' },
            ...(tab === 'unmatched' ? [{ key: 'map', header: '', sortable: false, render: (r) => <button className="btn-secondary btn-sm" onClick={() => map.onOpen(r)} data-testid="map-punch"><Link2 size={14} /> Map</button> }] : []),
          ]} />
      )}
      <FormModal open={add.open} onClose={add.onClose} title="Add attendance device" submitLabel="Add device"
        fields={[{ name: 'name', label: 'Name', required: true, placeholder: 'e.g. Reception – Bengaluru HQ' }, { name: 'serial_no', label: 'Serial number (SN)', required: true, hint: 'Printed on the device or under Menu → System info' }, { name: 'location_id', label: 'Location', type: 'lookup', path: 'locations' }]}
        onSubmit={async (v) => { const r = await act('attendance-devices/devices', { body: v, success: 'Device added' }); if (r?.key) setKeyInfo(r); return !!r; }} />
      <FormModal open={map.open} onClose={map.onClose} title={map.payload ? `Map device user ${map.payload.biometric_id}` : ''} submitLabel="Map and apply punches"
        fields={[{ name: 'employee_id', label: 'Employee', type: 'employee', required: true, full: true }]}
        onSubmit={(v) => act('attendance-devices/map', { body: { biometric_id: map.payload.biometric_id, employee_id: v.employee_id }, success: 'Mapped — attendance updated', invalidates: ['attendance', 'employees'] })} />
      <KeyModal info={keyInfo} onClose={() => setKeyInfo(null)} />
    </div>
  );
}
