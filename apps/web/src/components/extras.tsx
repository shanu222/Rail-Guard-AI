'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { dt, pretty } from '@/lib/format';

export function Legend5() {
  return (
    <ul
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-xs"
      aria-label="Risk legend"
    >
      {[
        ['#2E9E5B', '1 Low'],
        ['#8CC63F', '2 Guarded'],
        ['#F2B01E', '3 Elevated'],
        ['#E8643A', '4 High'],
        ['#D62839', '5 Critical'],
        ['#9AA5B4', 'Not scored'],
      ].map(([c, l]) => (
        <li key={l} className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm" style={{ background: c }} aria-hidden /> {l}
        </li>
      ))}
    </ul>
  );
}

export function CreateWorkOrder({
  open,
  onClose,
  segmentId,
  detections,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  segmentId: string;
  detections: any[];
  onDone: () => void;
}) {
  const users = useQuery({
    queryKey: ['assignees'],
    queryFn: () => api<{ id: string; name: string; role: string }[]>('/v1/assignees'),
    enabled: open,
  });
  const [priority, setPriority] = useState('MEDIUM');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const m = useMutation({
    mutationFn: () =>
      api('/v1/work-orders', {
        method: 'POST',
        body: {
          segmentId,
          detectionIds: ids,
          priority,
          assignedTo: assignee || null,
          dueDate: due || null,
          notes: notes || undefined,
        },
      }),
    onSuccess: onDone,
  });
  return (
    <Modal open={open} onClose={onClose} title="Create work order">
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Field label="Due date">
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Assign to">
          <Select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({pretty(u.role)})
              </option>
            ))}
          </Select>
        </Field>
        {detections.length > 0 && (
          <fieldset className="space-y-1 text-sm">
            <legend className="mb-1 text-xs font-medium text-ink-soft">Link detections</legend>
            {detections.map((x) => (
              <label key={x.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={ids.includes(x.id)}
                  onChange={(e) =>
                    setIds((v) => (e.target.checked ? [...v, x.id] : v.filter((i) => i !== x.id)))
                  }
                />{' '}
                {pretty(x.defectClass)} · {x.severity} · {dt(x.detectedAt)}
              </label>
            ))}
          </fieldset>
        )}
        <Field label="Notes">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {m.error && (
          <p role="alert" className="text-sm text-risk-5">
            {(m.error as Error).message}
          </p>
        )}
        <Button className="w-full" disabled={m.isPending} onClick={() => m.mutate()}>
          {m.isPending ? 'Creating…' : 'Create work order'}
        </Button>
      </div>
    </Modal>
  );
}
