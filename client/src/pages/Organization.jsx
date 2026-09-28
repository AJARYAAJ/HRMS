import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { PageHeader, Tabs } from '../components/ui';
import CrudTable from '../components/CrudTable';

export default function Organization() {
  const [tab, setTab] = useState('departments');
  return (
    <div>
      <PageHeader icon={Building2} title="Organization setup" subtitle="Departments, designations, locations and work shifts" />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'departments', label: 'Departments' }, { value: 'designations', label: 'Designations' }, { value: 'locations', label: 'Locations' }, { value: 'shifts', label: 'Shifts' }]} />
      {tab === 'departments' && (
        <CrudTable path="departments" label="department" searchKeys={['name', 'code', 'head_name']}
          columns={[{ key: 'name', header: 'Department', render: (r) => <span className="font-semibold">{r.name}</span> }, { key: 'code', header: 'Code' }, { key: 'head_name', header: 'Head' }, { key: 'headcount', header: 'Headcount' }, { key: 'description', header: 'Description', width: 'minmax(200px, 2fr)' }]}
          fields={[{ name: 'name', label: 'Name', required: true }, { name: 'code', label: 'Code' }, { name: 'head_id', label: 'Department head', type: 'employee', full: true }, { name: 'description', label: 'Description', type: 'textarea', full: true }]} />
      )}
      {tab === 'designations' && (
        <CrudTable path="designations" label="designation" searchKeys={['title', 'level']}
          columns={[{ key: 'title', header: 'Designation', render: (r) => <span className="font-semibold">{r.title}</span> }, { key: 'level', header: 'Level' }, { key: 'headcount', header: 'Headcount' }]}
          fields={[{ name: 'title', label: 'Title', required: true }, { name: 'level', label: 'Level', type: 'select', options: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'] }]} />
      )}
      {tab === 'locations' && (
        <CrudTable path="locations" label="location" searchKeys={['name', 'city']}
          columns={[{ key: 'name', header: 'Location', render: (r) => <span className="font-semibold">{r.name}</span> }, { key: 'city', header: 'City' }, { key: 'state', header: 'State' }, { key: 'headcount', header: 'Headcount' }, { key: 'address', header: 'Address', width: 'minmax(200px, 2fr)' }]}
          fields={[{ name: 'name', label: 'Name', required: true }, { name: 'city', label: 'City' }, { name: 'state', label: 'State' }, { name: 'address', label: 'Address', type: 'textarea', full: true }]} />
      )}
      {tab === 'shifts' && (
        <CrudTable path="shifts" label="shift" searchKeys={['name']} defaults={{ start_time: '09:30', end_time: '18:30', grace_minutes: 15 }}
          columns={[{ key: 'name', header: 'Shift', render: (r) => <span className="font-semibold">{r.name}</span> }, { key: 'start_time', header: 'Start' }, { key: 'end_time', header: 'End' }, { key: 'grace_minutes', header: 'Grace (min)' }]}
          fields={[{ name: 'name', label: 'Name', required: true, full: true }, { name: 'start_time', label: 'Start', type: 'time', required: true }, { name: 'end_time', label: 'End', type: 'time', required: true }, { name: 'grace_minutes', label: 'Late grace (minutes)', type: 'number', min: 0 }]} />
      )}
    </div>
  );
}
