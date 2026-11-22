'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, Card, CardHeader, Field, Select } from '@/components/ui';
import { api } from '@/lib/api';

type Status = {
  present: boolean;
  divisions: number;
  devices: number;
  detections: number;
  events: number;
};

/** Admin > Demo data: load a full simulated dataset, or remove every demo record, with one click. */
export function DemoTab() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['demo-status'],
    queryFn: () => api<Status>('/v1/admin/demo'),
  });
  const [days, setDays] = useState(45);
  const [confirmClear, setConfirmClear] = useState(false);
  const refreshAll = () => {
    // demo data touches every page: refetch everything
    void qc.invalidateQueries();
  };
  const load = useMutation({
    mutationFn: () =>
      api<Record<string, number | string>>('/v1/admin/demo/load', {
        method: 'POST',
        body: { days },
      }),
    onSuccess: refreshAll,
  });
  const clear = useMutation({
    mutationFn: () => api('/v1/admin/demo/clear', { method: 'POST' }),
    onSuccess: () => {
      setConfirmClear(false);
      refreshAll();
    },
  });
  const s = status.data;
  const busy = load.isPending || clear.isPending;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Demo data"
          sub="Simulated data for demonstrations. Every demo record is flagged and labelled DEMO DATA; it is never a Pakistan Railways result."
        />
        <div className="grid gap-3 p-4 sm:grid-cols-4">
          <div className="rounded-lg border border-line p-3">
            <div className="text-xs text-ink-soft">Status</div>
            <div className="mt-1">
              {s?.present ? (
                <Badge tone="accent">Demo data loaded</Badge>
              ) : (
                <Badge tone="teal">No demo data</Badge>
              )}
            </div>
          </div>
          {(
            [
              ['Demo devices', s?.devices],
              ['Demo detections', s?.detections],
              ['Demo crossing events', s?.events],
            ] as const
          ).map(([l, v]) => (
            <div key={l} className="rounded-lg border border-line p-3">
              <div className="text-xs text-ink-soft">{l}</div>
              <div className="mt-1 text-xl font-semibold text-ink">{v ?? '–'}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Show demo data"
            sub="Creates the demo division (24.7 km section, 247 segments, 3 level crossings, 2 Track Units, 3 Crossing Units) with simulated history, reviews, risk scores and work orders."
          />
          <div className="flex flex-wrap items-end gap-3 p-4">
            <Field label="History">
              <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {[14, 30, 45, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    Last {d} days
                  </option>
                ))}
              </Select>
            </Field>
            <Button disabled={busy} onClick={() => load.mutate()}>
              {load.isPending ? 'Loading demo data… (up to a minute)' : 'Load demo data'}
            </Button>
          </div>
          <div className="px-4 pb-4 text-sm">
            {s?.present && !load.isPending && (
              <p className="text-ink-soft">Loading again replaces the existing demo data.</p>
            )}
            {load.isSuccess && (
              <p role="status" className="text-teal-dark">
                Demo data loaded: {String(load.data.detections)} detections,{' '}
                {String(load.data.crossingEvents)} crossing events, {String(load.data.runs)} runs.
              </p>
            )}
            {load.error && (
              <p role="alert" className="text-risk-5">
                {(load.error as Error).message}
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Remove demo data"
            sub="Deletes every demo-flagged record: the demo division and everything in it, demo devices, demo users and demo model versions. Your real divisions, devices, users and reports are not touched."
          />
          <div className="flex flex-wrap items-center gap-3 p-4">
            {!confirmClear ? (
              <Button
                variant="ghost"
                disabled={busy || !s?.present}
                onClick={() => setConfirmClear(true)}
              >
                Remove all demo data
              </Button>
            ) : (
              <>
                <span className="text-sm text-ink">This cannot be undone. Remove it?</span>
                <Button disabled={busy} onClick={() => clear.mutate()}>
                  {clear.isPending ? 'Removing…' : 'Yes, remove demo data'}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmClear(false)}>
                  Cancel
                </Button>
              </>
            )}
          </div>
          <div className="px-4 pb-4 text-sm">
            {clear.isSuccess && (
              <p role="status" className="text-teal-dark">
                Demo data removed. The DEMO DATA badge disappears once no demo records remain.
              </p>
            )}
            {clear.error && (
              <p role="alert" className="text-risk-5">
                {(clear.error as Error).message}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
