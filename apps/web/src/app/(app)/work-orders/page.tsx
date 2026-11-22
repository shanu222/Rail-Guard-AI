'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { useRef, useState } from 'react';
import { WORK_ORDER_STATUSES } from '@railguard/shared';
import {
  Async,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageTitle,
  Select,
  SkeletonRows,
  Table,
  Td,
  Textarea,
  Th,
  statusTone,
} from '@/components/ui';
import { api, putToPresigned } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CHAINAGE, dt, pretty } from '@/lib/format';

const PRIORITY_TONE = { LOW: 'slate', MEDIUM: 'amber', HIGH: 'accent', CRITICAL: 'red' } as const;
const COLS = WORK_ORDER_STATUSES;

export default function WorkOrdersPage() {
  const [view, setView] = useState<'board' | 'list'>('board');
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['work-orders'],
    queryFn: () => api<any[]>('/v1/work-orders'),
    refetchInterval: 60_000,
  });
  const overdue = (w: any) =>
    w.dueDate && !['DONE', 'CANCELLED'].includes(w.status) && new Date(w.dueDate) < new Date();

  return (
    <>
      <PageTitle
        title="Work orders"
        sub="Assign, track and close maintenance jobs with an evidence trail"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={view === 'board'}
              onClick={() => setView('board')}
            >
              Board
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              List
            </Button>
          </>
        }
      />
      {q.isLoading ? (
        <Card>
          <SkeletonRows />
        </Card>
      ) : q.error ? (
        <Card>
          <div role="alert" className="p-4 text-sm text-risk-5">
            {(q.error as Error).message}
          </div>
        </Card>
      ) : !q.data?.length ? (
        <Card>
          <EmptyState
            title="No work orders yet"
            hint="Open the Risk Map, click a segment and choose “Create work order”."
          />
        </Card>
      ) : view === 'board' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {COLS.map((col) => {
            const items = q.data.filter((w) => w.status === col);
            return (
              <section key={col} aria-label={pretty(col)} className="rounded-xl bg-slate-100 p-2">
                <h2 className="flex items-center justify-between px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  {pretty(col)} <Badge>{items.length}</Badge>
                </h2>
                <div className="space-y-2">
                  {items.map((w) => (
                    <button
                      key={w.id}
                      onClick={() => setOpen(w.id)}
                      className="block w-full rounded-lg border border-line bg-white p-3 text-start shadow-sm hover:border-accent"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{w.segment.section.name}</span>
                        <Badge tone={PRIORITY_TONE[w.priority as keyof typeof PRIORITY_TONE]}>
                          {w.priority}
                        </Badge>
                      </div>
                      <p className="text-xs text-ink-soft">
                        Chainage {CHAINAGE(w.segment.chainageStartM)} · {w.detectionIds.length}{' '}
                        detection(s)
                      </p>
                      <p className="mt-1 text-xs">
                        {w.assignedTo?.name ?? 'Unassigned'}
                        {w.dueDate && (
                          <span className={overdue(w) ? ' font-semibold text-risk-5' : ''}>
                            {' '}
                            · due {w.dueDate.slice(0, 10)}
                            {overdue(w) ? ' (overdue)' : ''}
                          </span>
                        )}
                      </p>
                    </button>
                  ))}
                  {!items.length && <p className="px-2 py-3 text-xs text-ink-soft">Empty</p>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Section / chainage</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
                <Th>Assigned</Th>
                <Th>Due</Th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((w) => (
                <tr
                  key={w.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setOpen(w.id)}
                >
                  <Td>
                    {w.segment.section.name} · {CHAINAGE(w.segment.chainageStartM)}
                  </Td>
                  <Td>
                    <Badge tone={PRIORITY_TONE[w.priority as keyof typeof PRIORITY_TONE]}>
                      {w.priority}
                    </Badge>
                  </Td>
                  <Td>
                    <Badge tone={statusTone(w.status)}>{pretty(w.status)}</Badge>
                  </Td>
                  <Td>{w.assignedTo?.name ?? '—'}</Td>
                  <Td className={overdue(w) ? 'font-semibold text-risk-5' : ''}>
                    {w.dueDate?.slice(0, 10) ?? '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
      {open && <WorkOrderModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function WorkOrderModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['work-order', id],
    queryFn: () => api<any>(`/v1/work-orders/${id}`),
  });
  const users = useQuery({
    queryKey: ['assignees'],
    queryFn: () => api<{ id: string; name: string }[]>('/v1/assignees'),
    enabled: can('work-orders:assign'),
  });
  const [note, setNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/v1/work-orders/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['work-order', id] });
      void qc.invalidateQueries({ queryKey: ['work-orders'] });
    },
  });

  async function addPhoto(f: File) {
    setUploading(true);
    try {
      const ct = f.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const { key, url } = await api<{ key: string; url: string }>(
        `/v1/work-orders/${id}/photo-url`,
        { method: 'POST', body: { contentType: ct } },
      );
      await putToPresigned(url, f, ct);
      await patch.mutateAsync({ photoKeys: [key] });
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Work order">
      <Async q={q}>
        {(w) => (
          <div className="space-y-4">
            <div>
              <p className="font-medium">
                {w.segment.section.name} · chainage {CHAINAGE(w.segment.chainageStartM)}–
                {CHAINAGE(w.segment.chainageEndM)}
              </p>
              <p className="text-xs text-ink-soft">
                Created {dt(w.createdAt)} by {w.createdBy?.name ?? '—'}
              </p>
              {w.notes && <p className="mt-2 rounded bg-slate-50 p-2 text-sm">{w.notes}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status">
                <Select
                  value={w.status}
                  disabled={patch.isPending}
                  onChange={(e) => patch.mutate({ status: e.target.value })}
                >
                  {WORK_ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {pretty(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              {can('work-orders:assign') && (
                <Field label="Due date">
                  <Input
                    type="date"
                    defaultValue={w.dueDate?.slice(0, 10)}
                    onBlur={(e) => e.target.value && patch.mutate({ dueDate: e.target.value })}
                  />
                </Field>
              )}
              {can('work-orders:assign') && (
                <Field label="Assigned to">
                  <Select
                    value={w.assignedTo?.id ?? ''}
                    onChange={(e) => patch.mutate({ assignedTo: e.target.value || null })}
                  >
                    <option value="">Unassigned</option>
                    {users.data?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {can('work-orders:assign') && (
                <Field label="Priority">
                  <Select
                    value={w.priority}
                    onChange={(e) => patch.mutate({ priority: e.target.value })}
                  >
                    {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            {patch.error && (
              <p role="alert" className="text-sm text-risk-5">
                {(patch.error as Error).message}
              </p>
            )}

            <section>
              <h3 className="mb-1 text-sm font-semibold">Linked detections</h3>
              {w.detections.length ? (
                <ul className="text-sm">
                  {w.detections.map((d: any) => (
                    <li key={d.id}>
                      {pretty(d.defectClass)} · {d.severity} · {d.reviewStatus}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-soft">None linked.</p>
              )}
            </section>

            <section>
              <h3 className="mb-1 flex items-center justify-between text-sm font-semibold">
                Photo evidence
                <span>
                  <input
                    ref={file}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    aria-label="Add photo"
                    onChange={(e) => e.target.files?.[0] && void addPhoto(e.target.files[0])}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={uploading}
                    onClick={() => file.current?.click()}
                  >
                    <Camera className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Add'}
                  </Button>
                </span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {w.photoUrls.map((u: string) => (
                  <img key={u} src={u} alt="Evidence" className="h-24 rounded border border-line" />
                ))}
                {!w.photoUrls.length && <p className="text-xs text-ink-soft">No photos yet.</p>}
              </div>
            </section>

            <section>
              <h3 className="mb-1 text-sm font-semibold">Evidence trail</h3>
              <ol className="space-y-1 border-s-2 border-line ps-3 text-xs">
                {w.evidenceTrail.map((e: any, i: number) => (
                  <li key={i}>
                    <span className="font-medium">{pretty(e.action.split('.')[1])}</span> by {e.by}{' '}
                    · {dt(e.at)}
                  </li>
                ))}
                {!w.evidenceTrail.length && (
                  <li className="text-ink-soft">No activity recorded.</li>
                )}
              </ol>
            </section>
            <div className="flex gap-2">
              <Textarea
                aria-label="Add a note"
                rows={2}
                placeholder="Add a note…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                disabled={!note || patch.isPending}
                onClick={() =>
                  patch.mutate(
                    { notes: (w.notes ? w.notes + '\n' : '') + note },
                    { onSuccess: () => setNote('') },
                  )
                }
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </Async>
    </Modal>
  );
}
